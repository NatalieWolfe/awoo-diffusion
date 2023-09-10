import {Pool, PoolConfig, PoolConnection, SqlError} from 'mariadb';
import {Readable} from 'node:stream';

import {getSecret} from './secrets.mjs';

const RETRY_LIMIT = 10;

enum MariaError {
  ER_SOCKET_UNEXPECTED_CLOSE = 'ER_SOCKET_UNEXPECTED_CLOSE'
}

export async function getConfig(): Promise<PoolConfig> {
  return {
    host: process.env.AWOO_DATABASE_HOST,
    port: parseInt(process.env.AWOO_DATABASE_PORT, 10) || 3306,
    database: 'awoo',
    user: 'awoo',
    password: await getSecret('database-password'),
    bigIntAsNumber: true
  };
}

export class BaseDatabase {
  constructor(protected readonly pool: Pool) {}

  protected async withConnection<T>(
    func: (conn: PoolConnection) => Promise<T>
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      const res = await func(conn);
      await conn.release();
      return res;
    } catch (e) {
      if (conn.isValid()) {
        await this._tryRelease(conn);
      } else {
        conn.destroy();
      }

      throw e;
    }
  }

  protected async retriable<T>(func: (conn: PoolConnection) => Promise<T>) {
    let err = null;
    for (let retries = 0; retries < RETRY_LIMIT; ++retries) {
      try {
        return await this.withConnection(func);
      } catch (e) {
        if (!isRetriableSqlError(e)) throw e;
        err = e;
      }
    }
    throw err;
  }

  protected releaseOnEnd(conn: PoolConnection, stream: Readable) {
    const releaser = () => {
      conn.release();
      stream.removeListener('end', releaser);
      stream.removeListener('error', releaser);
    };

    stream.once('end', releaser);
    stream.once('error', releaser);
  }

  private async _tryRelease(conn: PoolConnection) {
    try {
      await conn.reset();
      await conn.release();
    } catch (resetError) {
      console.error(
        'Failed to reset/release connection after error:',
        resetError
      );
      conn.destroy();
    }
  }
}

export function isRetriableSqlError(e: any): boolean {
  if (!(e instanceof SqlError)) return false;
  return e.code === MariaError.ER_SOCKET_UNEXPECTED_CLOSE;
}
