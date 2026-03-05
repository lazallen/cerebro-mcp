/**
 * Load and save smart-meetings-config.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../common/logger';
import type { SmartMeetingsConfig } from '../../types/smart-meetings';

/**
 * Load smart-meetings-config.json from the given path.
 * If the path is not absolute, it is resolved relative to process.cwd().
 */
export async function loadSmartMeetingsConfig(configPath: string): Promise<SmartMeetingsConfig> {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  logger.info({
    operation: 'load_smart_meetings_config',
    path: resolvedPath,
    message: 'Loading smart-meetings config',
  });

  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `smart-meetings config file not found: ${resolvedPath}`
      );
    }
    throw err;
  }

  const config = JSON.parse(raw) as SmartMeetingsConfig;

  logger.info({
    operation: 'load_smart_meetings_config_done',
    path: resolvedPath,
    meetingCount: config.meetings?.length ?? 0,
    message: 'Smart-meetings config loaded',
  });

  return config;
}

/**
 * Atomically write smart-meetings-config.json to the given path.
 * Writes to a .tmp file first, then renames to avoid corruption on crash.
 */
export async function saveSmartMeetingsConfig(
  configPath: string,
  config: SmartMeetingsConfig
): Promise<void> {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  const tmpPath = `${resolvedPath}.tmp`;
  const serialised = JSON.stringify(config, null, 2) + '\n';

  logger.info({
    operation: 'save_smart_meetings_config',
    path: resolvedPath,
    meetingCount: config.meetings?.length ?? 0,
    message: 'Saving smart-meetings config',
  });

  await fs.writeFile(tmpPath, serialised, 'utf-8');
  await fs.rename(tmpPath, resolvedPath);

  logger.info({
    operation: 'save_smart_meetings_config_done',
    path: resolvedPath,
    message: 'Smart-meetings config saved',
  });
}
