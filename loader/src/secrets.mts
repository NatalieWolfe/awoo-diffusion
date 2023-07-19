import {promises as fs} from 'node:fs';

const _cache = new Map<string, string>();

export async function getSecret(name: string): Promise<string> {
  let value = _cache.get(name);
  if (!value) {
    const secretsDir = process.env.SECRETS_DIR || '../secrets';
    value = (await fs.readFile(`${secretsDir}/${name}`, 'utf8')).trim();
    _cache.set(name, value);
  }
  return value;
}
