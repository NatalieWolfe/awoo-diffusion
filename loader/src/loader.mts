import axios from 'axios';
import * as csv from 'csv';
import dayjs from 'dayjs';
import EventEmitter from 'node:events';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {setTimeout} from 'node:timers/promises';
import {createGunzip} from 'node:zlib';

import {Database, openDatabase} from './database.mjs';
import {Post, PostSelection, Rating} from './schema/types.mjs';

interface DumpPost {
  id:               number;
  uploader_id:      number;
  created_at:       Date;
  md5:              string;
  source:           string[];
  rating:           Rating;
  image_width:      number;
  image_height:     number;
  tag_string:       string[];
  fav_count:        number;
  file_ext:         string;
  parent_id:        number;
  approver_id:      number;
  file_size:        number;
  comment_count:    number;
  description:      string;
  duration:         number;
  updated_at:       Date;
  is_deleted:       boolean;
  is_pending:       boolean;
  is_flagged:       boolean;
  score:            number;
  up_score:         number;
  down_score:       number;
  is_rating_locked: boolean;
  is_status_locked: boolean;
  is_note_locked:   boolean;
}

const MINIMUM_SCORE = 300;
const MINIMUM_FAVCOUNT = 500;

const EXCLUDED_TAGS = new Set([
  '2d_animation',
  '3d_animation',
  'animated',
  'censored',
  'child',
  'comic',
  'cub',
  'donald_trump',
  'human',
  'human_focus',
  'human_on_anthro',
  'human_on_feral',
  'loli',
  'motion_tweening',
  'multiple_images',
  'nazi',
  'nazi_flag',
  'nazi_salute',
  'nazifur',
  'not_furry',
  'not_furry_focus',
  'rape',
  'shitpost',
  'sound',
  'ss_insignia',
  'swastika',
  'toddler',
  'young',
  'webm',
]);

const NUMBER_COLUMNS = new Set([
  'approver_id',
  'comment_count',
  'down_score',
  'duration',
  'fav_count',
  'file_size',
  'id',
  'image_height',
  'image_width',
  'parent_id',
  'score',
  'up_score',
  'uploader_id',
]);

const STRING_COLUMNS = new Set([
  'description',
  'file_ext',
  'md5',
  'rating',
]);

const ARRAY_COLUMNS = new Set([
  'source',
  'tag_string',
]);

const DATE_COLUMNS = new Set([
  'created_at',
  'updated_at',
]);

const BOOL_COLUMNS = new Set([
  'is_deleted',
  'is_flagged',
  'is_note_locked',
  'is_pending',
  'is_rating_locked',
  'is_status_locked',
]);

const IGNORED_COLUMNS = new Set([
  'change_seq',
  'locked_tags',
]);

function castaway(
  value: string,
  {column, header}
): number | boolean | string | Date | string[] | null {
  if (header) return value;

  if (NUMBER_COLUMNS.has(column)) {
    return parseInt(value, 10) || null;
  }
  if (STRING_COLUMNS.has(column)) {
    return value || null;
  }
  if (ARRAY_COLUMNS.has(column)) {
    return value.split(/[\s\n]+/m);
  }
  if (DATE_COLUMNS.has(column)) {
    return value ? new Date(value) : null;
  }
  if (BOOL_COLUMNS.has(column)) {
    return value === 't';
  }
  if (!IGNORED_COLUMNS.has(column)) {
    throw new Error(`Unknown column ${column} with value ${value}`);
  }
}

function validatePost(post: Post): boolean {
  return (
    post.commentCount >= 0 &&
    post.fileSize > 0 &&
    post.imageWidth > 0 &&
    post.imageHeight > 0
  );
}

async function loader() {
  const buffer = new PostBuffer(await openDatabase());
  const postsGzName = `posts-${getDate()}.csv.gz`;
  const res = await axios.get<Readable>(
    `https://e621.net/db_export/${postsGzName}`, {
    responseType: 'stream'
  });
  console.log('GET posts database:', res.status);
  const postsFilePath =
    path.join(await mkdtemp(path.join(tmpdir(), 'e621-loader-')), postsGzName);
  res.data.pipe(createWriteStream(postsFilePath));
  res.data.once('end', () => console.log('Finished download.'));

  // Give the download time to write for a bit.
  await setTimeout(1000);
  const readStream = createReadStream(postsFilePath);

  const stream = readStream.pipe(createGunzip()).pipe(
    csv.parse({
      cast: castaway,
      columns: true,
      encoding: 'utf8',
      maxRecordSize: 100 << 20,  // 100 MiB
    })
  ).pipe(
    csv.transform((post: DumpPost): Post => ({
      postId:         post.id,
      parentId:       post.parent_id,
      md5:            post.md5,
      uploaderId:     post.uploader_id,
      approverId:     post.approver_id,
      createdAt:      post.created_at,
      updatedAt:      post.updated_at,
      rating:         post.rating,
      imageWidth:     post.image_width,
      imageHeight:    post.image_height,
      fileExt:        post.file_ext,
      fileSize:       post.file_size,
      commentCount:   post.comment_count || 0,
      description:    post.description || '',
      duration:       post.duration,
      score:          post.score || 0,
      upScore:        post.up_score || 0,
      downScore:      Math.abs(post.down_score || 0),
      favCount:       post.fav_count || 0,
      isDeleted:      post.is_deleted,
      isPending:      post.is_pending,
      isFlagged:      post.is_flagged,
      isRatingLocked: post.is_rating_locked,
      isStatusLocked: post.is_status_locked,
      isNoteLocked:   post.is_note_locked,
      tags:           post.tag_string,
      sources:        post.source
    }))
  );
  stream.on('readable', () => {
    let post: Post;
    while ((post = stream.read()) !== null) {
      let skip = false;
      for (const tag of post.tags) {
        if (EXCLUDED_TAGS.has(tag)) {
          skip = true;
          break;
        }
      }
      if (skip || !validatePost(post)) continue;
      buffer.add(post);
    }
  });

  buffer.on('pause', () => readStream.pause());
  buffer.on('resume', () => readStream.resume());

  await new Promise<void>((resolve, reject) => {
    stream.once('end', () => { resolve(); });
    stream.once('error', reject);
  });
  await buffer.flush();
  await buffer.close();
  await rm(postsFilePath);
  console.log('Finished!');
}

function getDate(): string {
  return dayjs().format('YYYY-MM-DD');
}

class PostBuffer extends EventEmitter {
  private buf: Post[] = [];
  private results: Promise<void>[] = [];
  private total = 0;
  private pauseDepth = 0;

  constructor(private readonly db: Database) {
    super();
  }

  add(post: Post) {
    this.buf.push(post);
    if (this.buf.length > 200) {
      this.results.push(this._save());
    }
  }

  async flush() {
    if (this.buf.length) await this._save();
    await Promise.all(this.results);
  }

  close(): Promise<void> {
    return this.db.close();
  }

  private async _save() {
    const posts = this.buf;
    this.buf = [];
    if (this.results.length) {
      // Wait for prior save to finish before doing this one.
      this.emit('pause');
      ++this.pauseDepth;
      console.log('Pause!');
      await this.results[this.results.length - 1];
    }
    this.total += posts.length;
    const deferred = await this.db.insertPosts(posts);
    this.total -= deferred.length;
    console.log(this.total, 'total posts updated.');

    for (const post of deferred) {
      post.parentId = null;
      this.buf.push(post);
    }

    if (--this.pauseDepth <= 0) {
      console.log('Resume!');
      this.emit('resume');
    }
  }
}

async function selector() {
  const db = await openDatabase();
  let postSelection: PostSelection;
  const postsToSelect = new Set<PostSelection>();
  const postsToRemove = new Set<number>();
  for await (postSelection of await db.listPostSelections()) {
    if (
      postSelection.score >= MINIMUM_SCORE ||
      postSelection.favCount >= MINIMUM_FAVCOUNT
    ) {
      if (!postSelection.isSelected) postsToSelect.add(postSelection);
    } else if (postSelection.isSelected) {
      postsToRemove.add(postSelection.postId);
    }
  }

  console.log(
    'Adding', postsToSelect.size, 'and removing', postsToRemove.size,
    'selected posts'
  );
  await db.updatePostSelections({add: postsToSelect, remove: postsToRemove});
  await db.close();
}

loader().then(selector);
