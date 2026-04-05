import path from 'path';
import fsExtra from 'fs-extra';

import combineFiles from '@/utils/combine';
import logger from '@/options/logger';
import {
  generateSafeFilename,
  generateIdentifierSafeName,
  getSafeAppName,
} from '@/utils/name';
import { PakeAppOptions, PlatformMap, WindowConfig } from '@/types';
import { tauriConfigDirectory, npmDirectory } from '@/utils/dir';

export async function mergeConfig(
  url: string,
  options: PakeAppOptions,
  tauriConf: any,
) {
  // Ensure .pake directory exists and copy source templates if needed
  const srcTauriDir = path.join(npmDirectory, 'src-tauri');
  await fsExtra.ensureDir(tauriConfigDirectory);

  // Copy source config files to .pake directory (as templates)
  const sourceFiles = [
    'tauri.conf.json',
    'tauri.macos.conf.json',
    'pake.json',
  ];

  await Promise.all(
    sourceFiles.map(async (file) => {
      const sourcePath = path.join(srcTauriDir, file);
      const destPath = path.join(tauriConfigDirectory, file);

      if (
        (await fsExtra.pathExists(sourcePath)) &&
        !(await fsExtra.pathExists(destPath))
      ) {
        await fsExtra.copy(sourcePath, destPath);
      }
    }),
  );
  const {
    width,
    height,
    fullscreen,
    maximize,
    hideTitleBar,
    alwaysOnTop,
    appVersion,
    darkMode,
    disabledWebShortcuts,
    activationShortcut,
    userAgent,
    showSystemTray,
    systemTrayIcon,
    useLocalFile,
    identifier,
    name = 'pake-app',
    resizable = true,
    inject,
    proxyUrl,
    installerLanguage,
    hideOnClose,
    incognito,
    title,
    wasm,
    enableDragDrop,
    multiInstance,
    multiWindow,
    startToTray,
    forceInternalNavigation,
    internalUrlRegex,
    zoom,
    minWidth,
    minHeight,
    ignoreCertificateErrors,
    newWindow,
    camera,
    microphone,
  } = options;

  const { platform } = process;

  const platformHideOnClose = hideOnClose ?? platform === 'darwin';

  const tauriConfWindowOptions: Partial<WindowConfig> = {
    width,
    height,
    fullscreen,
    maximize,
    resizable,
    hide_title_bar: hideTitleBar,
    activation_shortcut: activationShortcut,
    always_on_top: alwaysOnTop,
    dark_mode: darkMode,
    disabled_web_shortcuts: disabledWebShortcuts,
    hide_on_close: platformHideOnClose,
    incognito: incognito,
    title: title,
    enable_wasm: wasm,
    enable_drag_drop: enableDragDrop,
    start_to_tray: startToTray && showSystemTray,
    force_internal_navigation: forceInternalNavigation,
    internal_url_regex: internalUrlRegex,
    zoom,
    min_width: minWidth,
    min_height: minHeight,
    ignore_certificate_errors: ignoreCertificateErrors,
    new_window: newWindow,
  };
  Object.assign(tauriConf.pake.windows[0], { url, ...tauriConfWindowOptions });

  tauriConf.productName = name;
  tauriConf.identifier = identifier;
  tauriConf.version = appVersion;

  // Always set mainBinaryName to ensure binary uniqueness
  tauriConf.mainBinaryName = `pake-${generateIdentifierSafeName(name)}`;

  const pathExists = await fsExtra.pathExists(url);
  if (pathExists) {
    logger.warn('✼ Your input might be a local file.');
    tauriConf.pake.windows[0].url_type = 'local';

    const fileName = path.basename(url);
    const dirName = path.dirname(url);

    const distDir = path.join(npmDirectory, 'dist');
    const distBakDir = path.join(npmDirectory, 'dist_bak');

    if (!useLocalFile) {
      const urlPath = path.join(distDir, fileName);
      await fsExtra.copy(url, urlPath);
    } else {
      fsExtra.moveSync(distDir, distBakDir, { overwrite: true });
      fsExtra.copySync(dirName, distDir, { overwrite: true });

      // ignore it, because about_pake.html have be erased.
      // const filesToCopyBack = ['cli.js', 'about_pake.html'];
      const filesToCopyBack = ['cli.js'];
      await Promise.all(
        filesToCopyBack.map((file) =>
          fsExtra.copy(path.join(distBakDir, file), path.join(distDir, file)),
        ),
      );
    }

    tauriConf.pake.windows[0].url = fileName;
    tauriConf.pake.windows[0].url_type = 'local';
  } else {
    tauriConf.pake.windows[0].url_type = 'web';
  }

  const platformMap: PlatformMap = {
    darwin: 'macos',
  };
  const currentPlatform = platformMap[platform];

  if (userAgent.length > 0) {
    tauriConf.pake.user_agent[currentPlatform] = userAgent;
  }

  tauriConf.pake.system_tray[currentPlatform] = showSystemTray;

  // Set macOS bundle targets (for app vs dmg)
  if (platform === 'darwin') {
    const validMacTargets = ['app', 'dmg'];
    if (validMacTargets.includes(options.targets)) {
      tauriConf.bundle.targets = [options.targets];
    }
  }

  // Set icon.
  const safeAppName = getSafeAppName(name);
  const platformIconMap: PlatformMap = {
    darwin: {
      fileExt: '.icns',
      path: `icons/${safeAppName}.icns`,
      defaultIcon: 'icons/icon.icns',
      message: 'macOS icon must be .icns type.',
    },
  };
  const iconInfo = platformIconMap[platform];
  const resolvedIconPath = options.icon ? path.resolve(options.icon) : null;
  const exists =
    resolvedIconPath && (await fsExtra.pathExists(resolvedIconPath));
  if (exists) {
    let updateIconPath = true;
    let customIconExt = path.extname(resolvedIconPath).toLowerCase();

    if (customIconExt !== iconInfo.fileExt) {
      updateIconPath = false;
      logger.warn(`✼ ${iconInfo.message}, but you give ${customIconExt}`);
      tauriConf.bundle.icon = [iconInfo.defaultIcon];
    } else {
      const iconPath = path.join(npmDirectory, 'src-tauri/', iconInfo.path);
      tauriConf.bundle.resources = [iconInfo.path];

      // Avoid copying if source and destination are the same
      const absoluteDestPath = path.resolve(iconPath);
      if (resolvedIconPath !== absoluteDestPath) {
        try {
          await fsExtra.copy(resolvedIconPath, iconPath);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              error.message.includes(
                'Source and destination must not be the same',
              )
            )
          ) {
            throw error;
          }
        }
      }
    }

    if (updateIconPath) {
      tauriConf.bundle.icon = [iconInfo.path];
    } else {
      logger.warn(`✼ Icon will remain as default.`);
    }
  } else {
    logger.warn(
      '✼ Custom icon path may be invalid, default icon will be used instead.',
    );
    tauriConf.bundle.icon = [iconInfo.defaultIcon];
  }

  // Set tray icon path.
  let trayIconPath = 'png/icon_512.png';
  if (systemTrayIcon.length > 0) {
    try {
      await fsExtra.pathExists(systemTrayIcon);
      // Check icon format, only support png for macOS
      let iconExt = path.extname(systemTrayIcon).toLowerCase();
      if (iconExt == '.png') {
        const trayIcoPath = path.join(
          npmDirectory,
          `src-tauri/png/${safeAppName}${iconExt}`,
        );
        trayIconPath = `png/${safeAppName}${iconExt}`;
        await fsExtra.copy(systemTrayIcon, trayIcoPath);
      } else {
        logger.warn(
          `✼ System tray icon must be .png, but you provided ${iconExt}.`,
        );
        logger.warn(`✼ Default system tray icon will be used.`);
      }
    } catch {
      logger.warn(`✼ ${systemTrayIcon} not exists!`);
      logger.warn(`✼ Default system tray icon will remain unchanged.`);
    }
  }

  // Ensure trayIcon object exists before setting iconPath
  if (!tauriConf.app.trayIcon) {
    tauriConf.app.trayIcon = {};
  }
  tauriConf.app.trayIcon.iconPath = trayIconPath;
  tauriConf.pake.system_tray_path = trayIconPath;

  delete tauriConf.app.trayIcon;

  const injectFilePath = path.join(
    npmDirectory,
    `src-tauri/src/inject/custom.js`,
  );

  // inject js or css files
  if (inject?.length > 0) {
    // Ensure inject is an array before calling .every()
    const injectArray = Array.isArray(inject) ? inject : [inject];
    if (
      !injectArray.every(
        (item) => item.endsWith('.css') || item.endsWith('.js'),
      )
    ) {
      logger.error('The injected file must be in either CSS or JS format.');
      return;
    }
    const files = injectArray.map((filepath) =>
      path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath),
    );
    tauriConf.pake.inject = files;
    await combineFiles(files, injectFilePath);
  } else {
    tauriConf.pake.inject = [];
    await fsExtra.writeFile(injectFilePath, '');
  }
  tauriConf.pake.proxy_url = proxyUrl || '';
  tauriConf.pake.multi_instance = multiInstance;
  tauriConf.pake.multi_window = multiWindow;

  // Configure WASM support with required HTTP headers
  if (wasm) {
    tauriConf.app.security = {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    };
  }

  // Write entitlements dynamically on macOS so camera/microphone are opt-in
  if (platform === 'darwin') {
    const entitlementEntries: string[] = [];
    if (camera) {
      entitlementEntries.push(
        '    <key>com.apple.security.device.camera</key>\n    <true/>',
      );
    }
    if (microphone) {
      entitlementEntries.push(
        '    <key>com.apple.security.device.audio-input</key>\n    <true/>',
      );
    }
    const entitlementsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
${entitlementEntries.join('\n')}
  </dict>
</plist>
`;
    const entitlementsPath = path.join(
      npmDirectory,
      'src-tauri',
      'entitlements.plist',
    );
    await fsExtra.writeFile(entitlementsPath, entitlementsContent);
  }

  // Save config file.
  const platformConfigPaths: PlatformMap = {
    darwin: 'tauri.macos.conf.json',
  };

  const configPath = path.join(
    tauriConfigDirectory,
    platformConfigPaths[platform],
  );

  const bundleConf = { bundle: tauriConf.bundle };
  await fsExtra.outputJSON(configPath, bundleConf, { spaces: 4 });
  const pakeConfigPath = path.join(tauriConfigDirectory, 'pake.json');
  await fsExtra.outputJSON(pakeConfigPath, tauriConf.pake, { spaces: 4 });

  let tauriConf2 = JSON.parse(JSON.stringify(tauriConf));
  delete tauriConf2.pake;

  // delete tauriConf2.bundle;
  if (process.env.NODE_ENV === 'development') {
    tauriConf2.bundle = bundleConf.bundle;
  }
  const configJsonPath = path.join(tauriConfigDirectory, 'tauri.conf.json');
  await fsExtra.outputJSON(configJsonPath, tauriConf2, { spaces: 4 });
}
