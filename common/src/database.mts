import {Pool, PoolConfig, PoolConnection} from 'mariadb';
import {Readable} from 'node:stream';

import {getSecret} from './secrets.mjs';

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
      throw e;
    }
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
}
