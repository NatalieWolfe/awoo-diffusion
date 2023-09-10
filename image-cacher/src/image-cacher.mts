import axios from 'axios';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout} from 'node:timers/promises';

import {Database, DownloadablePost, openDatabase} from './database.mjs';
import {QueueProcessor} from './queue-processor.mjs';

const OLD_CACHE_PATH = '/var/e621-cache/image-data/images';
const NEW_CACHE_PATH = '/var/awoo/images';
const E621_STATIC_PATH = 'https://static1.e621.net/data';
const DOWNLOAD_DELAY = 5 * 1000; // 5 seconds in milliseconds

class DownloadQueue extends QueueProcessor<DownloadablePost> {
  private _downloadedPostCount = 0;

  constructor(private readonly db: Database) {
    super((post) => this._download(post));
  }

  get downloadedPostCount() { return this._downloadedPostCount; }

  private async _download(post: DownloadablePost) {
    await setTimeout(DOWNLOAD_DELAY);
    const postFolder1 = post.md5.substring(0, 2);
    const postFolder2 = post.md5.substring(2, 4);
    const postUrl = path.join(
      E621_STATIC_PATH,
      postFolder1,
      postFolder2,
      `${post.md5}.${post.extension}`
    );
    try {
      console.log(
        'Downloading', post.postId, ';', this.size, 'posts queued;',
        this._downloadedPostCount, 'posts downloaded.'
      );
      const res = await axios<Readable>({
        method: 'get',
        url: postUrl,
        responseType: 'stream'
      });
      if (res.status !== 200) {
        console.error('Failed to download post', post.postId, res.status);
        return;
      }
      await saveStream(post, res.data);

      if (await getFileHash(getPostPath(post)) !== post.md5) {
        console.error('Download of', post.postId, 'corrupted!');
        return;
      }

      ++this._downloadedPostCount;
      await this.db.markPostDownloaded(post.postId);
    } catch (err) {
      if (err.response?.status === 404) {
        console.error('Post', post.postId, 'not found. MD5:', post.md5);
      } else {
        console.error('Failed to download post', post.postId, err);
      }
    }
  }
}

class ValidationQueue extends QueueProcessor<DownloadablePost> {
  private _redownloadedCount = 0;

  constructor(
    private readonly db: Database,
    private readonly downloadQueue: DownloadQueue
  ) {
    super((post) => this._validateImage(post));
  }

  get redownloadedCount() { return this._redownloadedCount; }

  private async _validateImage(post: DownloadablePost) {
    const postPath = getPostPath(post);
    if (await tryGetFileHash(postPath) === post.md5) return;
    console.log('Post', post.postId, 'image changed, removing.');
    await Promise.all([
      tryRm(postPath),
      this.db.unmarkPostDownloaded(post.postId)
    ]);
    this.downloadQueue.push(post);
    ++this._redownloadedCount;
  }
}

async function imageCacher() {
  const db = await openDatabase();
  const downloadQueue = new DownloadQueue(db);
  let post: DownloadablePost;
  let movedPostCount = 0;
  for await (post of await db.listPostsToDownload()) {
    if (await moveDownloadedImage(post)) {
      console.log('Moved', post.postId);
      ++movedPostCount;
      await db.markPostDownloaded(post.postId);
    } else {
      downloadQueue.push(post);
    }
  }
  console.log(movedPostCount, 'posts moved.');

  const validationQueue = new ValidationQueue(db, downloadQueue);
  for await (post of await db.listDownloadedPosts()) {
    validationQueue.push(post);
  }
  await validationQueue.flush()
  console.log(
    'Validated', validationQueue.processedCount, 'posts, reqeueued',
    validationQueue.redownloadedCount
  );

  if (downloadQueue.size) console.log('Waiting for downloads to complete.');
  await downloadQueue.flush();
  console.log(downloadQueue.downloadedPostCount, 'posts downloaded.');
  await db.close();
}

async function moveDownloadedImage(post: DownloadablePost): Promise<boolean> {
  const postDir = `${post.postId % 1000}`;
  const postFilename = `${post.postId}.${post.extension}`;
  const imagePath = path.join(OLD_CACHE_PATH, postDir, postFilename);
  if (await tryGetFileHash(imagePath) !== post.md5) return false;

  let destinationPath = path.join(NEW_CACHE_PATH, postDir);
  await fs.mkdir(destinationPath, {recursive: true});
  destinationPath = path.join(destinationPath, postFilename);
  await fs.copyFile(imagePath, destinationPath);
  return true;
}

function saveStream(post: DownloadablePost, stream: Readable): Promise<void> {
  const outFile = createWriteStream(getPostPath(post));
  stream.pipe(outFile);
  return new Promise((resolve, reject) => {
    stream.once('end', () => {
      stream.removeListener('error', reject);
      outFile.close();
      resolve();
    });
    stream.once('error', reject);
  });
}

function getPostPath(post: DownloadablePost): string {
  const postDir = `${post.postId % 1000}`;
  const postFilename = `${post.postId}.${post.extension}`;
  return path.join(NEW_CACHE_PATH, postDir, postFilename);
}

async function tryRm(filePath: string) {
  try {
    await fs.rm(filePath);
  } catch {}
}

async function tryGetFileHash(filePath: string): Promise<string|null> {
  try {
    return await getFileHash(filePath);
  } catch {
    return null;
  }
}

function getFileHash(filePath: string): Promise<string> {
  const hasher = createHash('md5');
  const stream = createReadStream(filePath);
  stream.pipe(hasher);
  return new Promise((resolve, reject) => {
    stream.once('end', () => {
      stream.removeListener('error', reject);
      stream.close((err) => {
        if (err) reject(err);
        resolve(hasher.digest().toString('hex'));
      });
    });
    stream.once('error', reject);
  });
}

imageCacher();
