import { runExtract } from './extract.js';
import { runCreate } from './create.js';

export async function runMigrate(token, source, target, opts, log) {
  log.info('Starting migration from source...');
  const extraction = await runExtract(token, source.spaceId, source.envId, source.entryId, {
    maxDepth: opts.maxDepth,
    skipTypes: opts.skipTypes,
  }, log);
  return runCreate(token, extraction, target, opts, log);
}
