import * as mariadb from 'mariadb';
import {promises as fs} from 'node:fs';
import {Readable} from 'node:stream';

import {BaseDatabase, getConfig} from 'common/src/database.mjs';

import {Post, PostSelection} from './schema/types.mjs';

const SCHEMA_VERSION = 1;
const SCHEMA_DIR = './src/schema';

enum MariaError {
  BAD_TABLE_ERROR     = 1051,
  UNKNOWN_TABLE       = 1109,
  NO_SUCH_TABLE       = 1146,
  NO_REFERENCED_ROW   = 1216,
  NO_REFERENCED_ROW_2 = 1452,
}

interface TagsRow {
  tag_id: number,
  tag: string
}

interface PostUpdateSummaryRow {
  post_id: number,
  updated_at?: Date,
  up_score: number,
  down_score: number,
  fav_count: number
}

interface TagDiff {
  addedTags: number[],
  removedTags: number[]
}

export class Database extends BaseDatabase {
  private readonly tagCache = new Map<string, number>();

  async insertPosts(posts: Post[]): Promise<Post[]> {
    return await this.withConnection(this._insertPosts.bind(this, posts));
  }

  async listPostSelections(): Promise<Readable> {
    const conn = await this.pool.getConnection();
    const stream = conn.queryStream(`
      SELECT
        posts.post_id AS postId,
        posts.rating,
        posts.score,
        posts.fav_count AS favCount,
        posts.is_deleted AS isDeleted,
        selectable_posts.is_downloaded IS TRUE AS isDownloaded,
        selectable_posts.is_downloaded IS NOT NULL AS isSelected
      FROM posts
      LEFT JOIN selectable_posts USING (post_id);
    `);
    this.releaseOnEnd(conn, stream);
    return stream;
  }

  async updatePostSelections(
    {add, remove}: {add: Set<PostSelection>, remove: Set<number>}
  ) {
    return await this.withConnection(async (conn: mariadb.PoolConnection) => {
      await conn.beginTransaction();
      const BLOCK_SIZE = 20000;
      if (remove && remove.size) {
        const removeArray = [...remove];
        for (let i = 0; i < remove.size; i+= BLOCK_SIZE) {
          const toRemove = removeArray.slice(i, i + BLOCK_SIZE);
          await conn.execute(`
            DELETE FROM selectable_posts
            WHERE post_id IN (${_makePlaceholders(toRemove.length)})
          `, toRemove);
        }
      }

      if (add && add.size) {
        const addArray = [...add];
        for (let i = 0; i < add.size; i += BLOCK_SIZE) {
          await this._insertSelections(conn, addArray.slice(i, i + BLOCK_SIZE));
        }
      }
      await conn.commit();
    });
  }

  listTags(postId: number): Promise<string[]> {
    return this.withConnection(async (conn) => {
      const tagRows = await conn.execute<TagsRow[]>(`
        SELECT tag_id, tag
        FROM post_tags
        LEFT JOIN tags USING (tag_id)
        WHERE post_tags.post_id = ?
      `, [postId]);
      return tagRows.map((tagRow) => tagRow.tag);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async _insertPosts(
    posts: Post[],
    conn: mariadb.PoolConnection
  ): Promise<Post[]> {
    const deferredPosts: Post[] = [];
    const insertPost = await conn.prepare(`
      INSERT INTO posts (
        post_id,        parent_id,    md5,              uploader_id,
        approver_id,    created_at,   updated_at,       rating,
        image_width,    image_height, file_ext,         file_size,
        comment_count,  description,  duration,         score,
        up_score,       down_score,   fav_count,        is_deleted,
        is_pending,     is_flagged,   is_rating_locked, is_status_locked,
        is_note_locked
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?
      ) ON DUPLICATE KEY UPDATE
        parent_id = ?,        md5 = ?,            updated_at = ?,
        rating = ?,           image_width = ?,    image_height = ?,
        file_ext = ?,         file_size = ?,      comment_count = ?,
        description = ?,      score = ?,          up_score = ?,
        down_score = ?,       fav_count = ?,      is_deleted = ?,
        is_pending = ?,       is_flagged = ?,     is_rating_locked = ?,
        is_status_locked = ?, is_note_locked = ?
    `);
    const removePostSources =
      await conn.prepare(`DELETE FROM post_sources WHERE post_id = ?`);
    const insertPostSource = await conn.prepare(
      `INSERT INTO post_sources (post_id, source) VALUES (?, ?)`
    );

    const storedPosts = new Map<number, PostUpdateSummaryRow>();
    for (
      const storedPost of
      await conn.execute<PostUpdateSummaryRow[]>(`
        SELECT post_id, file_ext, updated_at, up_score, down_score, fav_count
        FROM posts
        WHERE post_id IN (${_makePlaceholders(posts.length)})
      `, posts.map((post) => post.postId))
    ) {
      storedPosts.set(storedPost.post_id, storedPost)
    }

    let skipCount = 0;
    await conn.beginTransaction();
    for (const post of posts) {
      try {
        const storedPost = storedPosts.get(post.postId)
        if (
          storedPost &&
          storedPost.updated_at?.getTime() === post.updatedAt?.getTime() &&
          storedPost.up_score === post.upScore &&
          storedPost.down_score === post.downScore &&
          storedPost.fav_count === post.favCount
        ) {
          ++skipCount;
          continue;
        }

        await insertPost.execute([
          // Insertion values.
          post.postId,          post.parentId,        post.md5,
          post.uploaderId,      post.approverId,      post.createdAt,
          post.updatedAt,       post.rating,          post.imageWidth,
          post.imageHeight,     post.fileExt,         post.fileSize,
          post.commentCount,    post.description,     post.duration,
          post.score,           post.upScore,         post.downScore,
          post.favCount,        post.isDeleted,       post.isPending,
          post.isFlagged,       post.isRatingLocked,  post.isStatusLocked,
          post.isNoteLocked,
          // Update values.
          post.parentId,        post.md5,             post.updatedAt,
          post.rating,          post.imageWidth,      post.imageHeight,
          post.fileExt,         post.fileSize,        post.commentCount,
          post.description,     post.score,           post.upScore,
          post.downScore,       post.favCount,        post.isDeleted,
          post.isPending,       post.isFlagged,       post.isRatingLocked,
          post.isStatusLocked,  post.isNoteLocked
        ]);

        const tags = await this._getTags(conn, post.tags);
        const tagDiff =
          await this._diffPostTags(conn, post.postId, [...tags.values()]);
        if (tagDiff.addedTags.length) {
          await this._addPostTags(conn, post.postId, tagDiff.addedTags);
        }
        if (tagDiff.removedTags.length) {
          await this._removePostTags(conn, post.postId, tagDiff.removedTags);
        }

        await removePostSources.execute([post.postId]);
        for (const source of post.sources) {
          await insertPostSource.execute([post.postId, source]);
        }
      } catch (e) {
        if (
          e instanceof mariadb.SqlError &&
          e.errno === MariaError.NO_REFERENCED_ROW_2
        ) {
          deferredPosts.push(post);
        } else {
          console.log(post);
          throw e;
        }
      }
    }
    await conn.commit();
    if (skipCount) console.log('Skipped', skipCount, 'up to date posts.');
    return deferredPosts;
  }

  private async _getTags(
    conn: mariadb.PoolConnection,
    tagNames: string[]
  ): Promise<Map<string, number>> {
    // Check the in-memory cache for loaded tags.
    const tagMap = new Map<string, number>();
    const uncachedTags = new Set<string>();
    for (const tag of tagNames) {
      const tagId = this.tagCache.get(tag);
      if (tagId !== undefined) {
        tagMap.set(tag, tagId);
      } else {
        uncachedTags.add(tag);
      }
    }

    if (uncachedTags.size) {
      // Load what tags are known.
      let tags = await conn.execute<TagsRow[]>(`
        SELECT tag_id, tag
        FROM tags
        WHERE tag IN (${_makePlaceholders(uncachedTags.size)})
      `, [...uncachedTags]);
      for (const tag of tags) {
        uncachedTags.delete(tag.tag);
        tagMap.set(tag.tag, tag.tag_id);
        this.tagCache.set(tag.tag, tag.tag_id);
      }

      if (uncachedTags.size) {
        // Insert and reload the tags that are new.
        const newTags = [...uncachedTags];
        await conn.execute(`
          INSERT INTO tags (tag)
          VALUES ${_makePlaceholders(newTags.length), '(?)'}
        `, newTags);
        tags = await conn.execute<TagsRow[]>(`
          SELECT tag_id, tag
          FROM tags
          WHERE tag IN (${_makePlaceholders(newTags.length)})
        `, newTags);
        for (const tag of tags) {
          tagMap.set(tag.tag, tag.tag_id);
          this.tagCache.set(tag.tag, tag.tag_id);
        }
      }
    }

    return tagMap;
  }

  private async _insertSelections(
    conn: mariadb.PoolConnection,
    posts: PostSelection[]
  ) {
    const values = new Array(posts.length * 3);
    let i = 0;
    for (const post of posts) {
      values[i + 0] = post.postId;
      values[i + 1] = post.favCount * post.score;
      values[i + 2] = post.rating;
      i += 3;
    }
    await conn.execute(`
      INSERT IGNORE selectable_posts (
        post_id, computed_score, is_downloaded, rating
      )
      VALUES ${_makePlaceholders(posts.length, '(?, ?, false, ?)')}
    `, values);
  }

  private async _diffPostTags(
    conn: mariadb.PoolConnection,
    postId: number,
    tagIds: number[]
  ): Promise<TagDiff> {
    const loadedTagIds = new Set(tagIds);
    const storedTagRows = await conn.execute<{tag_id: number}[]>(
      `SELECT tag_id FROM post_tags WHERE post_id = ?`,
      [postId]
    );
    const storedTagIds = new Set(storedTagRows.map((tag) => tag.tag_id));
    const diff = {addedTags: [], removedTags: []};
    for (const tagId of loadedTagIds) {
      if (!storedTagIds.has(tagId)) diff.addedTags.push(tagId);
    }
    for (const tagId of storedTagIds) {
      if (!loadedTagIds.has(tagId)) diff.removedTags.push(tagId);
    }
    return diff;
  }

  private async _addPostTags(
    conn: mariadb.PoolConnection,
    postId: number,
    tagIds: number[]
  ) {
    const values = [];
    for (const tagId of tagIds) {
      values.push(postId, tagId);
    }
    await conn.execute(`
      INSERT INTO post_tags (post_id, tag_id)
      VALUES ${_makePlaceholders(tagIds.length, '(?, ?)')}
    `, values);
  }

  private async _removePostTags(
    conn: mariadb.PoolConnection,
    postId: number,
    tagIds: number[]
  ) {
    await conn.execute(`
      DELETE FROM post_tags
      WHERE post_id = ?
      AND tag_id IN (${_makePlaceholders(tagIds.length)})
    `, [postId, ...tagIds]);
  }
}

export async function openDatabase(): Promise<Database> {
  const config = await getConfig();
  const schemaVersion = await _getSchemaVersion(config);
  if (schemaVersion === 0) {
    await _initializeSchema(config);
  } else if (schemaVersion < SCHEMA_VERSION) {
    await _upgradeSchema(config, schemaVersion);
  } else if (schemaVersion > SCHEMA_VERSION) {
    throw new Error('Database schema is ahead of expected version.');
  }
  return new Database(mariadb.createPool(config));
}

function _makePlaceholders(count: number, placeholder = '?'): string {
  if (count === 0) {
    return '';
  } else if (count === 1) {
    return placeholder;
  }
  return placeholder + (new Array(count)).join(`, ${placeholder}`);
}

async function _getSchemaVersion(
  config: mariadb.ConnectionConfig
): Promise<number> {
  const conn = await mariadb.createConnection(config);
  try {
    const [{id}] =
      await conn.query<{id: number}[]>('SELECT id FROM schema_version');
    await conn.end()
    return id;
  } catch (e) {
    if (conn.isValid()) await conn.end();
    if (e instanceof mariadb.SqlError && e.errno === MariaError.NO_SUCH_TABLE) {
      return 0;
    }
    throw e;
  }
}

async function _initializeSchema(config: mariadb.ConnectionConfig) {
  const conn = await mariadb.createConnection(config);
  const schemaText = await fs.readFile(`${SCHEMA_DIR}/schema.sql`, 'utf8');
  for (const statement of schemaText.split(/;[\s\n]+/m)) {
    try {
      if (statement.trim().length > 0) await conn.query(statement);
    } catch (e) {
      console.log(
        'Failed to execute schema query. Database may be in invalid a state.',
        e
      );
      if (conn.isValid()) await conn.end();
      throw e;
    }
  }
  await conn.end();
}

async function _upgradeSchema(
  config: mariadb.ConnectionConfig,
  schemaVersion: number
) {}
