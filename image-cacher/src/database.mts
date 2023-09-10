import * as mariadb from 'mariadb';
import {Readable} from 'node:stream';

import {database} from 'common';

export interface DownloadablePost {
  postId: number;
  md5: string;
  extension: string;
}

export class Database extends database.BaseDatabase {
  listPostsToDownload(): Promise<Readable> {
    return this._listDownloadablePosts(/*isDownloaded=*/false);
  }

  listDownloadedPosts(): Promise<Readable> {
    return this._listDownloadablePosts(/*isDownloaded=*/true);
  }

  private async _listDownloadablePosts(
    isDownloaded: boolean
  ): Promise<Readable> {
    const conn = await this.pool.getConnection();
    const stream = conn.queryStream(`
      SELECT
        posts.post_id AS postId,
        posts.md5,
        posts.file_ext AS extension
      FROM selectable_posts
      LEFT JOIN posts USING (post_id)
      WHERE ${isDownloaded ? '' : 'NOT'} selectable_posts.is_downloaded
      ORDER BY selectable_posts.computed_score DESC
    `);
    this.releaseOnEnd(conn, stream);
    return stream;
  }

  async markPostDownloaded(postId: number) {
    await this.retriable(
      async (conn) => {
        conn.execute(
          'UPDATE selectable_posts SET is_downloaded = TRUE WHERE post_id = ?',
          [postId]
        );
      }
    );
  }

  async unmarkPostDownloaded(postId: number) {
    await this.retriable(
      async (conn) => {
        conn.execute(
          'UPDATE selectable_posts SET is_downloaded = FALSE WHERE post_id = ?',
          [postId]
        );
      }
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function openDatabase(): Promise<Database> {
  return new Database(mariadb.createPool(await database.getConfig()));
}
