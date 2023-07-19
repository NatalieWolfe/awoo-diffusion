import * as mariadb from 'mariadb';
import {promises as fs} from 'node:fs';
import {Readable} from 'node:stream';

import {getSecret} from './secrets.mjs';
import {Post, PostSelection, Rating} from './schema/types.mjs';

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

export class Database {
  private readonly tagCache = new Map<string, number>();

  constructor(private readonly pool: mariadb.Pool) {}

  async insertPosts(posts: Post[]): Promise<Post[]> {
    return await this._withConn(this._insertPosts.bind(this, posts));
  }

  async listPostSelections(): Promise<Readable> {
    const conn = await this.pool.getConnection();
    const stream = conn.queryStream(`
      SELECT
        posts.post_id AS postId,
        posts.rating,
        posts.score,
        posts.fav_count AS favCount,
        selectable_posts.is_downloaded IS TRUE AS isDownloaded,
        selectable_posts.is_downloaded IS NOT NULL AS isSelected
      FROM posts
      LEFT JOIN selectable_posts USING (post_id);
    `);
    _releaseOnEnd(conn, stream);
    return stream;
  }

  async updatePostSelections(
    {add, remove}: {add: Set<PostSelection>, remove: Set<number>}
  ) {
    return await this._withConn(async (conn: mariadb.PoolConnection) => {
      await conn.beginTransaction();
      if (remove && remove.size) {
        await conn.execute(`
          DELETE FROM selectable_posts
          WHERE post_id IN (?${(new Array(remove.size)).join(', ?')})
        `, [...remove]);
      }

      if (add && add.size) {
        const BLOCK_SIZE = 100;
        const addArray = [...add];
        for (let i = 0; i < add.size; i += BLOCK_SIZE) {
          await this._insertSelections(conn, addArray.slice(i, i + BLOCK_SIZE));
        }
      }
      await conn.commit();
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
        parent_id = ?,        updated_at = ?,       rating = ?,
        comment_count = ?,    description = ?,      score = ?,
        up_score = ?,         down_score = ?,       fav_count = ?,
        is_deleted = ?,       is_pending = ?,       is_flagged = ?,
        is_rating_locked = ?, is_status_locked = ?, is_note_locked = ?
    `);
    const insertPostTag = await conn.prepare(
      `INSERT INTO deferred_post_tags_queue (post_id, tag_id) VALUES (?, ?)`
    );
    const removePostSources =
      await conn.prepare(`DELETE FROM post_sources WHERE post_id = ?`);
    const insertPostSource = await conn.prepare(
      `INSERT INTO post_sources (post_id, source) VALUES (?, ?)`
    );

    const storedPosts = new Map<number, PostUpdateSummaryRow>();
    for (
      const storedPost of
      await conn.execute<PostUpdateSummaryRow[]>(`
        SELECT post_id, updated_at, up_score, down_score, fav_count
        FROM posts
        WHERE post_id IN (?${(new Array(posts.length)).join(', ?')})
      `, posts.map((post) => post.postId))
    ) {
      storedPosts.set(storedPost.post_id, storedPost)
    }

    let skipCount = 0;
    await conn.beginTransaction();
    for (const post of posts) {
      try {
        const storedPost = storedPosts.get(post.postId)
        if (storedPost) {
          if (
            storedPost.updated_at?.getTime() === post.updatedAt?.getTime() &&
            storedPost.up_score === post.upScore &&
            storedPost.down_score === post.downScore &&
            storedPost.fav_count === post.favCount
          ) {
            ++skipCount;
            continue;
          }
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
          post.parentId,        post.updatedAt,       post.rating,
          post.commentCount,    post.description,     post.score,
          post.upScore,         post.downScore,       post.favCount,
          post.isDeleted,       post.isPending,       post.isFlagged,
          post.isRatingLocked,  post.isStatusLocked,  post.isNoteLocked
        ]);

        const tags = await this._getTags(post.tags, conn);
        for (const tagId of tags.values()) {
          await insertPostTag.execute([post.postId, tagId]);
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
    tagNames: string[],
    conn: mariadb.PoolConnection
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
        WHERE tag IN (?${(new Array(uncachedTags.size)).join(', ?')})
      `, [...uncachedTags]);
      for (const tag of tags) {
        uncachedTags.delete(tag.tag);
        tagMap.set(tag.tag, tag.tag_id);
        this.tagCache.set(tag.tag, tag.tag_id);
      }

      if (uncachedTags.size) {
        // Insert and reload the tags that are new.
        const newTags = [...uncachedTags];
        const placeholders = new Array(newTags.length);
        await conn.execute(
          `INSERT INTO tags (tag) VALUES (?)${placeholders.join(', (?)')}`,
          newTags
        );
        tags = await conn.execute<TagsRow[]>(`
          SELECT tag_id, tag
          FROM tags
          WHERE tag IN (?${(new Array(newTags.length)).join(', ?')})
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
      VALUES
        (?, ?, false, ?)
        ${(new Array(posts.length)).join(', (?, ?, false, ?)')}
    `, values);
  }

  private async _withConn<T>(
    func: (conn: mariadb.PoolConnection) => Promise<T>
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      const res = await func(conn);
      await conn.release();
      return res;
    } catch (e) {
      if (conn.isValid()) {
        try {
          await conn.reset();
          await conn.release();
        } catch (resetError) {
          console.log('Failed to reset/release conn after error: ', resetError);
          conn.destroy();
        }
      }
      throw e;
    }
  }
}

export async function openDatabase(): Promise<Database> {
  const config: mariadb.PoolConfig = {
    host: process.env.AWOO_DATABASE_HOST,
    port: parseInt(process.env.AWOO_DATABASE_PORT, 10) || 3306,
    database: 'awoo',
    user: 'awoo',
    password: await getSecret('database-password'),
    bigIntAsNumber: true
  };
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

function _releaseOnEnd(conn: mariadb.PoolConnection, stream: Readable) {
  const releaser = () => {
    conn.release();
    stream.removeListener('end', releaser);
    stream.removeListener('error', releaser);
  };

  stream.once('end', releaser);
  stream.once('error', releaser);
}
