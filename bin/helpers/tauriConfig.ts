import path from 'path';
import fsExtra from 'fs-extra';
import { npmDirectory } from '@/utils/dir';

// Load configs from npm package directory, not from project source
const tauriSrcDir = path.join(npmDirectory, 'src-tauri');
const pakeConf = fsExtra.readJSONSync(path.join(tauriSrcDir, 'pake.json'));
const CommonConf = fsExtra.readJSONSync(
  path.join(tauriSrcDir, 'tauri.conf.json'),
);
const MacConf = fsExtra.readJSONSync(
  path.join(tauriSrcDir, 'tauri.macos.conf.json'),
);

const { platform } = process;

let tauriConfig = {
  ...CommonConf,
  bundle: MacConf.bundle,
  app: {
    ...CommonConf.app,
    trayIcon: {
      ...(MacConf?.app?.trayIcon ?? {}),
    },
  },
  build: CommonConf.build,
  pake: pakeConf,
};

export default tauriConfig;
