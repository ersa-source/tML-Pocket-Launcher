const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LAUNCHER_TEST_URL || 'http://127.0.0.1:8769';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined,
  });
  try {
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 932, height: 430 },
      reducedMotion: 'reduce',
    });
    const errors = [];
    const capture = async (name) => {
      if (!process.env.LAUNCHER_CAPTURE) return;
      const dir = path.resolve(__dirname, '../../../build/ui-previews');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, name + '.png'),
        animations: 'disabled',
        style: '#toast { visibility: hidden !important; }',
      });
    };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = {
        protocol: 1,
        ready: true,
        runtime: true,
        terraria: 'Imported Terraria resources',
        terrariaSource: 'steam',
        tml: 'v2026.10.1.0',
        busy: false,
        error: null,
        retry: false,
        message: '操作完成',
        operation: 'state',
        progress: 100,
        mods: [
          {
            id: 'ActualMod',
            title: '设备模组',
            version: '1.2',
            loaderVersion: '2026.10.1.0',
            author: '实际作者',
            description: '',
            deps: [],
            side: 0,
            size: 1048576,
            enabled: false,
          },
        ],
        packs: [],
        patches: [
          {
            id: 'mobile-touch',
            name: 'MobileJoystick 触摸适配',
            description: '原生多点触摸',
            version: '1.0.14',
            builtin: true,
            required: true,
            enabled: true,
            targetVersion: '',
            launchArguments: [],
          },
          {
            id: 'mobile-fps',
            name: '帧率显示',
            description: '实际呈现 FPS',
            version: '1.0.0',
            builtin: true,
            required: false,
            enabled: false,
            targetVersion: '',
            launchArguments: [],
          },
        ],
        preferences: { orientation: 'landscape', theme: 'dark', renderScale: 100 },
        renderers: [
          {
            identity: 'native',
            packageName: '',
            packageVersion: '',
            rendererId: 'native',
            displayName: '系统原生 OpenGL ES 3',
            description: '',
            backend: 'native',
          },
          {
            identity: 'dev.example.renderer:gl4es',
            packageName: 'dev.example.renderer',
            packageVersion: '1.2',
            rendererId: 'gl4es',
            displayName: 'GL4ES',
            description: '',
            backend: 'gl4es',
          },
        ],
        appVersion: '0.1.0',
      };
      const controls = {};
      window.nativeCalls = [];
      window.nativeFixture = state;
      const stores = {
        steam: { phase: 'signedOut', account: '', message: '尚未登录', owned: false },
        gog: { phase: 'signedOut', account: '', message: '尚未登录', owned: false },
      };
      window.nativeStores = stores;
      const send = (message) =>
        window.LauncherNative.onmessage?.({ data: JSON.stringify(message) });
      window.LauncherNative = {
        onmessage: null,
        postMessage(text) {
          const { id, method, params } = JSON.parse(text);
          window.nativeCalls.push({ method, params });
          let data = true;
          let error;
          if (method === 'state' || method === 'refresh') data = state;
          else if (method === 'terraria.mobile.inspect')
            data = window.mobileTerrariaFixture ?? { status: 'not-installed' };
          else if (method === 'terraria.mobile.convert') state.terrariaSource = 'android';
          else if (method === 'controls.read') data = controls;
          else if (method === 'controls.save') data = Object.assign(controls, params.settings);
          else if (method === 'files.roots')
            data = {
              granted: !!window.nativeStorageGranted,
              roots: [
                { id: 'launcher', label: '启动器文件', path: '/public/launcher' },
                ...(window.nativeStorageGranted
                  ? [{ id: 'storage', label: '内部存储', path: '/storage/emulated/0' }]
                  : []),
              ],
              restricted:
                'Android/data 与 Android/obb 受系统保护，请将文件放到 Download 或 Documents。',
            };
          else if (method === 'files.permission') {
            setTimeout(() => window.dispatchEvent(new Event('launcher:files-resume')), 20);
          } else if (method === 'files.list') {
            const names =
              params.kind === 'terraria-gog'
                ? ['Terraria.sh']
                : params.kind === 'mod'
                  ? ['First.tmod', 'Second.tmod']
                  : params.kind === 'image'
                    ? ['forest.png']
                    : params.kind === 'pack'
                      ? ['enabled.json']
                      : params.kind === 'export'
                        ? ['existing.json']
                        : params.kind === 'tml'
                          ? ['tModLoader.zip']
                          : ['Terraria.zip'];
            const entries = [
              ...(params.path
                ? []
                : [{ name: 'packages', path: 'packages', directory: true, size: 0, modified: 0 }]),
              ...names.map((name) => ({
                name,
                path: [params.path, name].filter(Boolean).join('/'),
                directory: false,
                size: 1048576,
                modified: 1700000000000,
              })),
            ].filter((file) =>
              file.name.toLowerCase().includes((params.query || '').toLowerCase()),
            );
            data = { entries, total: entries.length, hasMore: false };
          } else if (method === 'files.export') {
            if (params.name === 'existing.json') error = '同名文件已存在，请更换名称';
            else data = { name: params.name, path: '/public/launcher/' + params.name };
          } else if (method === 'files.image') {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 16;
            data = { data: canvas.toDataURL('image/png') };
          } else if (method === 'store.status') data = stores;
          else if (method === 'store.steam.details') {
            if (window.steamDetailsFailure) error = 'Steam 商店暂时不可用';
            else
              data = {
                appId: 105600,
                name: 'Terraria',
                description: 'Steam 官方简介：挖掘、战斗、探索、建造。',
                developers: ['Re-Logic'],
                publishers: ['Re-Logic'],
                genres: ['冒险', '独立'],
                releaseDate: '2011 年 5 月 16 日',
                headerImage: '',
                storeUrl: 'https://store.steampowered.com/app/105600/',
                cached: !!window.steamDetailsStale,
                stale: !!window.steamDetailsStale,
                fetchedAt: Date.now(),
              };
          } else if (method === 'store.steam.login') {
            stores.steam = {
              phase: 'email',
              account: '',
              message: '请输入 Steam 发到邮箱的验证码',
              owned: false,
            };
          } else if (method === 'store.steam.guard') {
            stores.steam = {
              phase: 'ready',
              account: 'FixtureSteam',
              message: '已拥有 Terraria，可以下载资源',
              owned: true,
            };
          } else if (method === 'store.steam.reconnect') {
            stores.steam = {
              phase: 'ready',
              account: 'FixtureSteam',
              message: '已拥有 Terraria，可以下载资源',
              owned: true,
            };
          } else if (method === 'store.steam.probe') {
            data = {
              reachable: true,
              message: 'Steam 连接可用 · TCP',
              attempts: [
                { route: 'WebSocket', ok: false, reason: '握手失败' },
                { route: 'TCP', ok: true },
              ],
            };
          } else if (method === 'store.gog.authorize') {
            stores.gog = {
              phase: 'ready',
              account: 'FixtureGog',
              message: '已拥有 Terraria，可以下载资源',
              owned: true,
            };
          } else if (method === 'store.gog.installers')
            data = [
              {
                id: 'linux-en',
                name: 'Terraria Linux',
                version: '1.4.4.9',
                language: 'en',
                size: 1048576,
              },
            ];
          else if (method === 'store.steam.logout')
            stores.steam = { phase: 'signedOut', account: '', message: '尚未登录', owned: false };
          else if (
            method === 'store.steam.download' ||
            method === 'download' ||
            method === 'store.gog.download'
          ) {
            const source =
              method === 'download' ? 'tml' : method === 'store.gog.download' ? 'gog' : 'steam';
            if (window[`${source}DownloadMode`] === 'deferred') {
              Object.assign(state, {
                busy: true,
                operation: method,
                progress: 23,
                message: `${source}：下载资源 23/100 MB`,
                error: null,
              });
              send({ event: 'snapshot', data: state });
              window.finishNativeDownload = (outcome = 'success') => {
                Object.assign(state, {
                  busy: false,
                  progress: outcome === 'success' ? 100 : -1,
                  error:
                    outcome === 'cancel'
                      ? '操作已取消'
                      : outcome === 'failure'
                        ? '连接中断，请重试'
                        : null,
                  message: outcome === 'cancel' ? '操作已取消' : '操作完成',
                });
                send({ event: 'snapshot', data: state });
                send({ id, ok: outcome === 'success', data: true, error: state.error });
                window.finishNativeDownload = null;
              };
              return;
            }
            if (source === 'steam') error = 'Steam 资源 SHA-1 校验失败';
            if (source === 'tml') error = 'SHA-256 校验失败，请重试';
          } else if (method === 'cancel' && window.finishNativeDownload)
            window.finishNativeDownload('cancel');
          else if (method === 'settings.save')
            state.preferences = { ...state.preferences, ...params.preferences };
          else if (method === 'patches.toggle')
            state.patches.find((patch) => patch.id === params.id).enabled = params.enabled;
          else if (method === 'mods.enable') state.mods[0].enabled = params.enabled;
          else if (method === 'releases')
            data = {
              hasMore: false,
              releases: [
                {
                  id: '456',
                  tag: 'v2026.10.1.0',
                  name: '官方稳定版',
                  preview: false,
                  size: 104857600,
                },
              ],
            };
          else if (method === 'logs') data = { text: '[dotnet] 实际启动日志' };
          else if (method === 'packs.save')
            state.packs.push({ name: params.name, mods: ['ActualMod'] });
          else if (method === 'import' && params.kind.startsWith('terraria-'))
            state.terrariaSource = params.kind === 'terraria-gog' ? 'gog' : 'steam';
          else if (method === 'import' && params.kind === 'tml' && window.tmlImportFailure)
            error = window.tmlImportFailure;
          else if (method === 'launch') {
            if (
              state.terrariaSource === 'steam' &&
              (stores.steam.phase !== 'ready' || !stores.steam.owned)
            )
              error = '请登录拥有 Terraria 的 Steam 账户并验证所有权';
            else state.message = '已请求启动 Android 游戏';
          }
          setTimeout(() => {
            send({ event: 'snapshot', data: state });
            send({ id, ok: !error, data, error });
          }, 5);
        },
      };
    });
    await page.goto(base);
    await page.getByText('v2026.10.1.0', { exact: true }).first().waitFor();
    const setup = page.getByRole('region', { name: 'tModLoader 游戏状态' });
    for (const [title, file] of [
      ['Terraria', 'terraria.png'],
      ['tModLoader', 'tmodloader.png'],
    ]) {
      const icon = setup.getByRole('button', { name: new RegExp(`^${title} `) }).locator('img');
      assert.equal(await icon.count(), 1, `${title} should display a game icon`);
      assert.equal(await icon.getAttribute('src'), `/${file}`);
      await icon.evaluate((image) => image.decode());
    }
    assert.equal(await page.locator('#demo-toggle').count(), 0);
    assert.equal(await page.getByText(/示例稳定版本|示例资源包/).count(), 0);
    const nav = (id) => page.locator(`.main-nav [data-page="${id}"]`);
    const chooseFile = async (name) => {
      const browser = page.getByRole('dialog', { name: '选择文件', exact: true });
      await browser.locator('.file-entry').filter({ hasText: name }).click();
      await browser.getByRole('button', { name: '导入 1 个文件', exact: true }).click();
    };
    await nav('mods').click();
    await page.getByText('设备模组', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '导入 .tmod', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '添加模组', exact: true }).count(), 1);
    assert.equal(await page.getByRole('tab', { name: '下载模组', exact: true }).count(), 0);
    await capture('mods-cleanup-installed-landscape');
    await page.getByRole('button', { name: '添加模组', exact: true }).click();
    await page.getByRole('dialog', { name: '添加模组', exact: true }).waitFor();
    await capture('mods-cleanup-add-dialog');
    await page.getByRole('button', { name: '导入 .tmod', exact: true }).click();
    const modsBrowser = page.getByRole('dialog', { name: '选择文件', exact: true });
    await modsBrowser.locator('.file-entry').filter({ hasText: 'First.tmod' }).click();
    await modsBrowser.locator('.file-entry').filter({ hasText: 'Second.tmod' }).click();
    await modsBrowser.getByRole('button', { name: '导入 2 个文件', exact: true }).click();
    await modsBrowser.waitFor({ state: 'hidden' });
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls.some(
          (call) =>
            call.method === 'import' &&
            call.params.kind === 'mod' &&
            call.params.files.length === 2,
        ),
      ),
    );
    const countBeforeCancel = await page.evaluate(
      () => window.nativeCalls.filter((call) => call.method === 'import').length,
    );
    await page.getByRole('button', { name: '添加模组', exact: true }).click();
    await page.getByRole('button', { name: '导入 .tmod', exact: true }).click();
    await page
      .getByRole('dialog', { name: '选择文件', exact: true })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => window.nativeCalls.filter((call) => call.method === 'import').length,
      ),
      countBeforeCancel,
    );
    assert.equal(
      await page.getByRole('switch', { name: '启用MobileJoystick', exact: true }).count(),
      0,
    );
    const builtInRow = page.locator('.native-mod-row').filter({ hasText: 'MobileJoystick' });
    assert.equal(await builtInRow.count(), 0);
    const modSearch = page.getByRole('searchbox', { name: '搜索已安装模组' });
    await modSearch.fill('nothing-matches');
    await page.getByText('没有匹配的模组', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByRole('button', { name: '已停用', exact: true }).click();
    assert.equal(await builtInRow.count(), 0);
    await page.getByRole('button', { name: '全部', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '全部停用', exact: true }).count(), 0);
    await page.getByRole('button', { name: '模组批量操作', exact: true }).click();
    await page.getByRole('button', { name: '全部停用', exact: true }).click();
    await page.waitForFunction(() =>
      window.nativeCalls.some((call) => call.method === 'mods.enable' && !call.params.enabled),
    );
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls
          .filter((call) => call.method === 'mods.enable')
          .every((call) => !call.params.ids.includes('MobileJoystick')),
      ),
    );
    for (const size of [
      { width: 932, height: 430 },
      { width: 800, height: 360 },
      { width: 640, height: 360 },
      { width: 480, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(size);
      const workspace = page.locator('.native-mods-workspace');
      assert.ok(
        await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        `mods workspace width at ${size.width}`,
      );
      const toolbar = await page.locator('.native-mod-tools').boundingBox();
      assert.ok(
        toolbar && toolbar.height <= (size.width >= 800 ? 48 : 100),
        `compact toolbar at ${size.width}: ${toolbar?.height}`,
      );
      const searchBox = await modSearch.boundingBox();
      assert.ok(searchBox && searchBox.height <= 44, `compact search at ${size.width}`);
      if (size.width === 932) await capture('mods-compact-landscape');
      if (size.width === 390) await capture('mods-compact-portrait');
    }
    await page.setViewportSize({ width: 932, height: 430 });
    await nav('patches').click();
    await page.getByText('MobileJoystick 触摸适配', { exact: false }).waitFor();
    assert.equal(
      await page.getByRole('switch', { name: '启用MobileJoystick 触摸适配', exact: true }).count(),
      0,
    );
    await page.getByRole('tab', { name: /可选补丁/ }).click();
    await page.getByRole('switch', { name: '启用帧率显示', exact: true }).click();
    await page.waitForFunction(
      () => window.nativeFixture.patches.find((patch) => patch.id === 'mobile-fps').enabled,
    );
    assert.equal(await page.getByRole('button', { name: '移除', exact: true }).count(), 0);
    await nav('mods').click();
    await page.getByRole('switch', { name: '启用设备模组', exact: true }).click();
    await page.waitForFunction(() => window.nativeFixture.mods[0].enabled);
    await page.getByRole('tab', { name: /模组包/ }).click();
    assert.equal(
      await page.getByRole('button', { name: '添加模组', exact: true }).count(),
      0,
      'pack tab has no unrelated mod action',
    );
    assert.equal(
      await page.getByRole('button', { name: '导入 JSON', exact: true }).count(),
      1,
      'one JSON import entry',
    );
    await page.getByRole('button', { name: '导入 JSON', exact: true }).click();
    await chooseFile('enabled.json');
    await page.waitForFunction(() =>
      window.nativeCalls.some((call) => call.method === 'import' && call.params.kind === 'pack'),
    );
    await page.getByRole('textbox', { name: '模组包名称' }).fill('实际清单');
    await page.getByRole('button', { name: '保存模组包', exact: true }).click();
    await page.getByText('实际清单', { exact: true }).waitFor();
    await capture('mods-cleanup-packs-landscape');
    await page.getByRole('button', { name: '导出', exact: true }).first().click();
    const saveDialog = page.getByRole('dialog', { name: '保存文件', exact: true });
    await saveDialog.getByLabel('导出文件名').fill('existing.json');
    await saveDialog.getByRole('button', { name: '保存到此目录', exact: true }).click();
    await saveDialog.getByRole('alert').filter({ hasText: '同名文件已存在' }).waitFor();
    await saveDialog.getByLabel('导出文件名').fill('my-mods.json');
    await saveDialog.getByRole('button', { name: '保存到此目录', exact: true }).click();
    await saveDialog.waitFor({ state: 'hidden' });
    await nav('games').click();
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    const mobileTerraria = page.getByRole('button', { name: '检测 Terraria PE' });
    await mobileTerraria.click();
    const mobileInspection = page.getByRole('dialog', { name: 'Terraria PE' });
    await mobileInspection.getByText(/本机未检测到/).waitFor();
    await page.keyboard.press('Escape');
    await mobileInspection.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.mobileTerrariaFixture = { status: 'unity', version: '1.4.5.8.6', apkCount: 2 };
    });
    await mobileTerraria.click();
    await mobileInspection.getByText('已检测到 Terraria 1.4.5.8.6，共 2 个 APK。').waitFor();
    await mobileInspection.getByText(/此 APK 未包含 Terraria PE 转换配置/).waitFor();
    await page.keyboard.press('Escape');
    await mobileInspection.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '导入资源', exact: true }).click();
    await page.getByRole('button', { name: '选择 ZIP', exact: true }).click();
    const fileDialog = page.getByRole('dialog', { name: '选择文件', exact: true });
    await fileDialog.getByRole('button', { name: '授予文件访问权限', exact: true }).click();
    await page.waitForFunction(() =>
      window.nativeCalls.some((call) => call.method === 'files.permission'),
    );
    assert.equal(
      await fileDialog.getByRole('button', { name: '内部存储', exact: true }).count(),
      0,
    );
    await page.evaluate(() => {
      window.nativeStorageGranted = true;
      window.dispatchEvent(new Event('launcher:files-resume'));
    });
    await fileDialog.getByRole('combobox', { name: '存储位置', exact: true }).click();
    await page.getByRole('option', { name: '内部存储', exact: true }).click();
    await fileDialog.locator('.file-entry').filter({ hasText: 'packages' }).click();
    await fileDialog.getByRole('button', { name: '上一级目录', exact: true }).click();
    for (const size of [
      { width: 932, height: 430 },
      { width: 800, height: 360 },
      { width: 640, height: 360 },
      { width: 480, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(size);
      assert.ok(
        await fileDialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        `file browser width at ${size.width}`,
      );
      await fileDialog.getByRole('button', { name: '取消', exact: true }).scrollIntoViewIfNeeded();
      const box = await fileDialog.getByRole('button', { name: '取消', exact: true }).boundingBox();
      assert.ok(
        box && box.y >= 0 && box.y + box.height <= size.height + 1,
        `file browser confirmation at ${size.width}`,
      );
      const listBox = await fileDialog.locator('.file-list').boundingBox();
      assert.ok(
        listBox && listBox.height >= size.height * 0.5,
        `file list gets most space at ${size.width}: ${listBox?.height}`,
      );
      if (size.width === 932) await capture('file-browser-landscape');
      if (size.width === 390) await capture('file-browser-portrait');
    }
    await page.setViewportSize({ width: 932, height: 430 });
    await fileDialog.getByLabel('搜索当前目录').fill('not-found');
    await fileDialog.locator('.file-empty').filter({ hasText: '当前目录中没有匹配项' }).waitFor();
    await fileDialog.getByLabel('搜索当前目录').fill('');
    await chooseFile('Terraria.zip');
    await page.getByRole('dialog', { name: 'Steam 资源已导入', exact: true }).waitFor();
    assert.ok(
      await page
        .getByText('启动前需要登录拥有 Terraria 的 Steam 账户。每次启动都会在线验证游戏所有权。')
        .count(),
    );
    await page.keyboard.press('Escape');
    await page.locator('.launch-button').click();
    await page.getByRole('dialog', { name: '暂时无法启动', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: '前往 Steam', exact: true }).count());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '导入资源', exact: true }).click();
    await page.getByRole('button', { name: '选择 .sh', exact: true }).click();
    await chooseFile('Terraria.sh');
    await page.getByRole('tab', { name: '已安装', exact: true }).click();
    await page
      .getByLabel('Terraria 资源状态', { exact: true })
      .getByText(/GOG · 离线可用/)
      .waitFor();
    await page.locator('.launch-button').click();
    await page.waitForFunction(() => window.nativeFixture.message === '已请求启动 Android 游戏');
    await page.evaluate(() => window.dispatchEvent(new Event('launcher:game-returned')));
    await page.locator('.game-launch-screen').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.nativeFixture.terrariaSource = 'steam';
    });
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls.some(
          (call) => call.method === 'import' && call.params.kind === 'terraria-steam',
        ),
      ),
    );
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls.some(
          (call) => call.method === 'import' && call.params.kind === 'terraria-gog',
        ),
      ),
    );
    const corruptPackageError =
      '安装包 ZIP 已损坏或下载不完整，请重新下载后导入。\n详细信息：EOFException：压缩数据意外结束';
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    await page.evaluate((reason) => (window.tmlImportFailure = reason), corruptPackageError);
    await page.getByRole('button', { name: '导入 ZIP', exact: true }).first().click();
    await chooseFile('tModLoader.zip');
    const importFailure = page.getByRole('dialog', { name: '导入失败', exact: true });
    await importFailure.waitFor({ timeout: 5000 });
    assert.ok((await importFailure.innerText()).includes(corruptPackageError));
    await capture('native-import-error');
    assert.equal(await page.getByRole('dialog', { name: '选择文件', exact: true }).count(), 0);
    await page.evaluate(() => (window.tmlImportFailure = '缺少必需文件：FNA.dll'));
    await importFailure.getByRole('button', { name: '重新选择', exact: true }).click();
    await chooseFile('tModLoader.zip');
    await importFailure.getByText('缺少必需文件：FNA.dll', { exact: true }).waitFor();
    await importFailure.getByRole('button', { name: '关闭', exact: true }).last().click();
    await importFailure.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window.tmlImportFailure = ''));
    await page.getByRole('button', { name: '导入 ZIP', exact: true }).first().click();
    await chooseFile('tModLoader.zip');
    await page.getByRole('dialog', { name: '选择文件', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog', { name: '导入失败', exact: true }).count(), 0);
    await page.waitForFunction(() => window.nativeCalls.some((call) => call.method === 'import'));
    await page.getByRole('button', { name: '下载版本', exact: true }).click();
    assert.equal(
      await page.locator('.drawer-footer').count(),
      0,
      'production drawers do not claim sample-only workflows',
    );
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await page.getByRole('button', { name: '下载并安装', exact: true }).click();
    const downloadWindow = page.getByRole('dialog', { name: '下载与安装', exact: true });
    await downloadWindow.waitFor({ timeout: 5000 });
    await downloadWindow.getByRole('alert').filter({ hasText: 'SHA-256 校验失败' }).waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('SHA-256 校验失败'));
    assert.ok(!page.url().endsWith('/downloads'), 'starting a download keeps the current page');
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    await page.locator('.topbar [data-action=tasks]').click();
    await page.getByRole('alert').filter({ hasText: 'SHA-256 校验失败' }).waitFor();
    await page.evaluate(() => (window.tmlDownloadMode = 'deferred'));
    await page.getByRole('button', { name: '重新下载', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishNativeDownload === 'function');
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    await nav('mods').click();
    await page.evaluate(() => window.finishNativeDownload());
    await page.waitForFunction(() =>
      document.querySelector('#toast')?.textContent.includes('已下载'),
    );
    assert.equal(
      await page.getByRole('dialog').count(),
      0,
      'background completion does not steal focus',
    );
    await page.locator('.topbar [data-action=tasks]').click();
    const releaseTask = page.locator('.download-card').filter({ hasText: 'GitHub' }).first();
    await releaseTask.getByText('安装完成', { exact: true }).waitFor();
    await releaseTask.getByRole('heading', { name: /tModLoader/ }).waitFor();
    await releaseTask.getByRole('button', { name: '查看下载窗口', exact: true }).click();
    await downloadWindow.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    await page.getByRole('button', { name: '查看已安装资源', exact: true }).click();
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    await page.getByRole('button', { name: '下载版本', exact: true }).click();
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await page.getByRole('button', { name: '下载并安装', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishNativeDownload === 'function');
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    await page.getByRole('button', { name: '返回上一页', exact: true }).click();
    await nav('mods').click();
    await page.evaluate(() => window.finishNativeDownload('failure'));
    await page.waitForFunction(() =>
      document.querySelector('#toast')?.textContent.includes('下载未完成'),
    );
    assert.equal(
      await page.getByRole('dialog').count(),
      0,
      'background failure does not steal focus',
    );
    await page.locator('.topbar [data-action=tasks]').click();
    const failedRelease = page.locator('.download-card').filter({ hasText: '连接中断，请重试' });
    await failedRelease.getByRole('alert').waitFor();
    assert.ok(await releaseTask.count(), 'session retains download tasks');
    await failedRelease.getByRole('button', { name: '重新下载', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishNativeDownload === 'function');
    await page.evaluate(() => window.finishNativeDownload());
    await downloadWindow.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    await downloadWindow.getByRole('button', { name: '查看已安装资源', exact: true }).click();
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    await page.getByRole('button', { name: 'Steam 登录与下载', exact: true }).click();
    await page.waitForURL('**/#games/steam-login');
    assert.equal(await page.getByRole('dialog').count(), 0, 'Steam uses a dedicated page');
    assert.equal(
      await page.locator('.game-dock').count(),
      0,
      'account pages use the available content space',
    );
    await page.getByLabel('Steam 账户名', { exact: true }).waitFor();
    await capture('steam-login-landscape');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('steam-login-portrait');
    await page.setViewportSize({ width: 932, height: 430 });
    await page.getByLabel('Steam 账户名', { exact: true }).fill('FixtureSteam');
    await page.getByLabel('Steam 密码', { exact: true }).fill('test-only-password');
    await page.getByRole('button', { name: '登录 Steam', exact: true }).click();
    await page.getByLabel('Steam Guard 验证码', { exact: true }).fill('ABCDE');
    await page.getByRole('button', { name: '提交验证码', exact: true }).click();
    await page.getByText('拥有 Terraria', { exact: true }).waitFor();
    await page.waitForURL('**/#games/steam-library');
    await page.getByText('Steam 官方简介：挖掘、战斗、探索、建造。', { exact: true }).waitFor();
    assert.equal(await page.getByText('Re-Logic', { exact: true }).count(), 2);
    await page.getByText('2011 年 5 月 16 日', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.steamDetailsStale = true;
    });
    await page.getByRole('button', { name: '刷新详情', exact: true }).click();
    await page.getByText('Steam 暂时不可用，显示已缓存的详情。', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.steamDetailsFailure = true;
    });
    await page.getByRole('button', { name: '刷新详情', exact: true }).click();
    await page.getByText('Steam 商店暂时不可用', { exact: true }).waitFor();
    assert.ok(
      await page.getByText('Steam 官方简介：挖掘、战斗、探索、建造。', { exact: true }).isVisible(),
    );
    await page.evaluate(() => {
      window.steamDetailsFailure = false;
      window.steamDetailsStale = false;
    });
    await page.getByRole('button', { name: '刷新详情', exact: true }).click();
    await capture('steam-library-landscape');
    assert.equal(await page.getByLabel('Steam 密码', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '下载 Terraria 资源', exact: true }).click();
    await downloadWindow.waitFor();
    assert.ok(page.url().endsWith('/steam-library'));
    await page.waitForFunction(() =>
      window.nativeCalls.some((call) => call.method === 'store.steam.download'),
    );
    await downloadWindow
      .getByRole('alert')
      .filter({ hasText: 'Steam 资源 SHA-1 校验失败' })
      .waitFor();
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    await page.locator('.topbar [data-action=tasks]').click();
    await page.waitForURL('**/#games/downloads');
    const statusCount = await page.evaluate(
      () => window.nativeCalls.filter((call) => call.method === 'store.status').length,
    );
    await page.waitForFunction(
      (count) => window.nativeCalls.filter((call) => call.method === 'store.status').length > count,
      statusCount,
    );
    assert.ok(
      await page.getByRole('alert').filter({ hasText: 'Steam 资源 SHA-1 校验失败' }).isVisible(),
    );
    await page.evaluate(() => {
      window.nativeStores.steam = {
        phase: 'disconnected',
        account: 'FixtureSteam',
        message: 'Steam 网络连接中断',
        owned: false,
        canReconnect: true,
        diagnostics: 'WebSocket：连接中断',
      };
    });
    await page.getByRole('button', { name: '恢复 Steam 连接', exact: true }).waitFor();
    await page.getByRole('button', { name: '恢复 Steam 连接', exact: true }).click();
    assert.equal(await page.getByLabel('Steam 密码', { exact: true }).count(), 0);
    await page.getByText('Steam 连接诊断', { exact: true }).click();
    await page.getByText('WebSocket：连接中断', { exact: true }).waitFor();
    await page.getByRole('button', { name: '恢复 Steam 连接', exact: true }).click();
    await page.getByText('拥有 Terraria', { exact: true }).waitFor();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '登录 Steam', exact: true }).waitFor();
    await page.getByRole('button', { name: '测试 Steam 连接', exact: true }).click();
    await page.locator('.steam-diagnostics summary').click();
    await page.getByRole('status').filter({ hasText: 'Steam 连接可用 · TCP' }).waitFor();
    const sizes = [
      { width: 932, height: 430 },
      { width: 844, height: 390 },
      { width: 667, height: 375 },
      { width: 480, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ];
    const fits = async () => {
      assert.ok(
        await page.evaluate(() => {
          const el = document.querySelector('#page-content');
          return (
            el.scrollWidth <= el.clientWidth + 1 &&
            document.documentElement.scrollWidth <= innerWidth
          );
        }),
        'workspace fits without horizontal overflow',
      );
    };
    for (const size of sizes) {
      await page.setViewportSize(size);
      await fits();
    }
    await page.setViewportSize({ width: 390, height: 390 });
    await page.getByLabel('Steam 密码', { exact: true }).fill('keyboard-only-fixture');
    await page.getByLabel('Steam 密码', { exact: true }).focus();
    await page.getByLabel('Steam 密码', { exact: true }).scrollIntoViewIfNeeded();
    assert.ok(
      await page.getByLabel('Steam 密码', { exact: true }).evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
    );
    await page.setViewportSize({ width: 932, height: 430 });
    await page.evaluate(() => {
      window.nativeStores.steam = {
        phase: 'ready',
        account: 'FixtureSteam',
        message: '已拥有 Terraria，可以下载资源',
        owned: true,
      };
      window.steamDownloadMode = 'deferred';
    });
    await page.waitForURL('**/#games/steam-library');
    for (const size of sizes) {
      await page.setViewportSize(size);
      await fits();
    }
    await page.setViewportSize({ width: 932, height: 430 });
    await page.getByRole('button', { name: '下载 Terraria 资源', exact: true }).click();
    await downloadWindow.waitFor();
    assert.ok(page.url().endsWith('/steam-library'));
    await page.waitForFunction(
      () => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '23',
    );
    await downloadWindow
      .getByRole('button', { name: '最小化', exact: true })
      .last()
      .scrollIntoViewIfNeeded();
    await capture('steam-download-landscape');
    for (const size of sizes) {
      await page.setViewportSize(size);
      await fits();
      assert.ok(
        await downloadWindow.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'download window fits phone',
      );
      if (size.width === 390) {
        await downloadWindow
          .getByRole('button', { name: '最小化', exact: true })
          .last()
          .scrollIntoViewIfNeeded();
        await capture('steam-download-portrait');
      }
    }
    await page.setViewportSize({ width: 932, height: 430 });
    const downloadsStarted = await page.evaluate(
      () => window.nativeCalls.filter((call) => call.method === 'store.steam.download').length,
    );
    const cancellations = await page.evaluate(
      () => window.nativeCalls.filter((call) => call.method === 'cancel').length,
    );
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    assert.ok(page.url().endsWith('/steam-library'), 'minimize returns to the original page');
    await page.getByRole('button', { name: '查看下载进度', exact: true }).click();
    await downloadWindow.waitFor();
    assert.equal(
      await page.evaluate(
        () => window.nativeCalls.filter((call) => call.method === 'store.steam.download').length,
      ),
      downloadsStarted,
      'reopen never starts a duplicate',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('launcher:back')));
    await downloadWindow.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(
        () => window.nativeCalls.filter((call) => call.method === 'cancel').length,
      ),
      cancellations,
      'back only minimizes',
    );
    await nav('mods').click();
    await page.locator('.topbar [data-action=tasks]').click();
    await page.waitForFunction(
      () => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '23',
    );
    const steamTask = page
      .locator('.download-card')
      .filter({ hasText: 'Steam · Linux 游戏资源' })
      .first();
    await steamTask.getByRole('button', { name: '取消任务', exact: true }).click();
    await steamTask.getByText('下载已取消', { exact: true }).waitFor();
    await steamTask.getByRole('button', { name: '重新下载', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishNativeDownload === 'function');
    await page.evaluate(() => window.finishNativeDownload());
    await downloadWindow.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    await capture('steam-download-completed');
    await downloadWindow.getByRole('button', { name: '最小化', exact: true }).last().click();
    assert.ok(page.url().endsWith('/downloads'), 'completion stays on the download result page');
    await page.evaluate(() => window.dispatchEvent(new Event('launcher:back')));
    await page.waitForFunction(() => !location.hash.includes('/'));
    await page.locator('.topbar [data-action=tasks]').click();
    await steamTask.getByText('安装完成', { exact: true }).waitFor();
    await steamTask.getByRole('button', { name: '查看已安装资源', exact: true }).click();
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    await page.getByRole('button', { name: 'GOG 登录与下载', exact: true }).click();
    await page.getByRole('button', { name: '打开 GOG 官方登录', exact: true }).click();
    await page.getByRole('button', { name: '读取可下载版本', exact: true }).click();
    await page.getByLabel('Terraria Linux 资源版本', { exact: true }).selectOption('linux-en');
    await page.getByRole('button', { name: '下载 Terraria 资源', exact: true }).click();
    await page.waitForFunction(() =>
      window.nativeCalls.some(
        (call) => call.method === 'store.gog.download' && call.params.id === 'linux-en',
      ),
    );
    await downloadWindow.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    assert.ok((await downloadWindow.innerText()).includes('GOG'));
    const cardColors = (card) =>
      card.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color, style.colorScheme];
      });
    const darkDownloadColors = await cardColors(downloadWindow.locator('.download-card'));
    await page.keyboard.press('Escape');
    await nav('settings').click();
    await page.locator('#settings-tab-controls').click();
    await page.getByText('内置触控系统', { exact: true }).waitFor();
    assert.equal(await page.getByRole('slider', { name: '按键不透明度', exact: true }).count(), 0);
    await page.locator('#settings-tab-control-management').click();
    assert.equal(await page.locator('#settings-tab-interface-management').count(), 0);
    const openEditor = () =>
      page.getByRole('button', { name: '编辑游戏布局', exact: true }).click();
    await openEditor();
    const editor = page.getByRole('dialog', { name: '游戏布局编辑' });
    const dock = editor.getByRole('button', { name: '悬浮菜单' });
    const menu = editor.getByRole('region', { name: '编辑菜单' });
    const openMenu = async () => {
      if (await menu.isVisible()) return;
      if ((await dock.getAttribute('aria-expanded')) === 'true') await dock.click();
      await dock.click();
    };
    const command = async (name) => {
      await openMenu();
      await menu.getByRole('button', { name, exact: true }).click();
    };
    const closePanel = async () => {
      if ((await dock.getAttribute('aria-expanded')) === 'true') await dock.click();
    };
    const canvas = editor.locator('.controls-preview');
    const dragBy = async (target, dx, dy) => {
      const { x, y, width, height } = await target.boundingBox();
      const startX = x + width / 2;
      const startY = y + height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + dx, startY + dy, { steps: 5 });
      await page.mouse.up();
    };
    const fullBounds = { x: 0, y: 0, width: 932, height: 430 };
    assert.deepEqual(await canvas.boundingBox(), fullBounds);
    const moveStick = canvas.getByRole('button', { name: '移动', exact: true });
    const aimStick = canvas.getByRole('button', { name: '瞄准', exact: true });
    const jumpButton = canvas.getByRole('button', { name: '跳跃', exact: true });
    const bagButton = canvas.getByRole('button', { name: '背包', exact: true });
    const mapButton = canvas.getByRole('button', { name: '地图', exact: true });
    const assertMobilePlacement = async (width, height) => {
      const scale = 1.8 * Math.min(width / 1920, height / 1080);
      const edge = 9 * scale;
      const inset = Math.max(4, Math.trunc(edge));
      const top = Math.max(4, Math.trunc(6 * scale));
      const mapSize = Math.trunc(40 * scale);
      const side = Math.max(16, Math.trunc(38 * scale));
      const bagX = Math.max(inset, Math.trunc(width * 0.056)) + Math.floor(side / 2);
      await page.waitForFunction(
        (left) =>
          Math.abs(
            parseFloat(
              document.querySelector('[aria-label="背包"].controls-preview-node')?.style.left,
            ) - left,
          ) < 0.001,
        (bagX / width) * 100,
      );
      const assertCenter = async (locator, x, y) => {
        const bounds = await locator.boundingBox();
        assert.ok(Math.abs(bounds.x + bounds.width / 2 - x) < 0.1);
        assert.ok(Math.abs(bounds.y + bounds.height / 2 - y) < 0.1);
      };
      const stickY = height - 104 * scale - edge;
      const aimX = width - Math.max(width * 0.15, 166 * scale + edge);
      await assertCenter(moveStick, Math.max(width * 0.203125, 166 * scale + edge), stickY);
      await assertCenter(aimStick, aimX, stickY);
      await assertCenter(jumpButton, aimX + 122 * scale, stickY - 84 * scale);
      assert.ok(Math.abs((await aimStick.boundingBox()).width - 132 * scale) < 0.1);
      await assertCenter(bagButton, bagX, top + Math.floor(side / 2));
      await assertCenter(
        mapButton,
        width - inset - mapSize + Math.floor(mapSize / 2),
        top + Math.floor(mapSize / 2),
      );
    };
    await assertMobilePlacement(932, 430);
    await page.setViewportSize({ width: 740, height: 460 });
    await assertMobilePlacement(740, 460);
    await page.setViewportSize({ width: 932, height: 430 });
    await assertMobilePlacement(932, 430);
    assert.equal(
      await bagButton.evaluate((element) => getComputedStyle(element).backgroundImage),
      'none',
    );
    await bagButton.click();
    const properties = editor.getByRole('complementary', { name: '属性' });
    await properties.getByRole('heading', { name: '背包', exact: true }).waitFor();
    assert.equal(await properties.getByRole('slider', { name: '控件横向位置' }).isEnabled(), true);
    assert.equal(await properties.getByRole('combobox', { name: '按键动作' }).inputValue(), '12');
    await properties.getByRole('button', { name: '关闭属性' }).click();
    const dockBefore = await dock.boundingBox();
    await dragBy(dock, -90, 60);
    const dockAfter = await dock.boundingBox();
    assert.ok(Math.abs(dockAfter.x - dockBefore.x + 90) < 1);
    assert.ok(Math.abs(dockAfter.y - dockBefore.y - 60) < 1);
    assert.equal(await dock.getAttribute('aria-expanded'), 'false');
    await command('属性');
    assert.deepEqual(await canvas.boundingBox(), fullBounds);
    assert.equal(await editor.getByRole('combobox', { name: '布局模式' }).inputValue(), '1');
    assert.equal(await editor.getByRole('button', { name: '药水', exact: true }).count(), 1);
    assert.equal((await editor.boundingBox()).width, 932);
    assert.equal((await editor.boundingBox()).height, 430);
    await command('添加控件');
    await editor.getByRole('button', { name: '方向键', exact: true }).click();
    await command('属性');
    await editor.getByRole('textbox', { name: '控件名称' }).fill('测试方向键');
    await editor.getByRole('combobox', { name: '方向键样式' }).selectOption('ROUND');
    await command('使用默认控件');
    assert.equal(await canvas.getByRole('button', { name: '测试方向键', exact: true }).count(), 0);
    await assertMobilePlacement(932, 430);
    await command('撤销');
    await canvas.getByRole('button', { name: '测试方向键', exact: true }).waitFor();
    await command('撤销');
    await closePanel();
    await canvas.getByRole('button', { name: '测试方向键', exact: true }).click();
    assert.equal(await editor.getByRole('combobox', { name: '方向键样式' }).inputValue(), 'CROSS');
    await command('重做');
    const controlScenes = menu.getByRole('group', { name: '预览场景' });
    await controlScenes.getByRole('button', { name: '背包', exact: true }).click();
    assert.equal(await canvas.getAttribute('data-scene'), 'inventory');
    assert.equal(await canvas.locator('.controls-art-slots.inventory > i').count(), 50);
    await controlScenes.getByRole('button', { name: '游戏', exact: true }).click();
    const fittedWidth = (await canvas.boundingBox()).width;
    await command('放大画布');
    assert.ok((await canvas.boundingBox()).width > fittedWidth * 1.2);
    await command('缩小画布');
    assert.equal((await canvas.boundingBox()).width, fittedWidth);
    const dpad = canvas.getByRole('button', { name: '测试方向键', exact: true });
    assert.equal(await dpad.getAttribute('data-control-type'), 'dpad');
    await command('纯预览');
    assert.equal(await canvas.getAttribute('data-grid'), 'false');
    assert.equal(await dpad.isDisabled(), true);
    assert.equal(await menu.isVisible(), false);
    await command('纯预览');
    assert.equal(await dpad.isEnabled(), true);
    await closePanel();
    const canvasBounds = await canvas.boundingBox();
    await dragBy(dpad, canvasBounds.width * 0.06, 0);
    assert.equal(await properties.isVisible(), false);
    await dpad.click();
    await properties.getByRole('heading', { name: '测试方向键', exact: true }).waitFor();
    const controlX = editor.getByRole('slider', { name: '控件横向位置', exact: true });
    assert.ok(Math.abs(Number(await controlX.inputValue()) - 0.555) <= 0.01);
    await command('网格吸附');
    await closePanel();
    await dragBy(dpad, canvasBounds.width * 0.003, canvasBounds.height * 0.028);
    await command('属性');
    const controlY = editor.getByRole('slider', { name: '控件纵向位置', exact: true });
    assert.equal(Number(await controlY.inputValue()), 0.53);
    const dpadWidth = editor.getByRole('slider', { name: '宽度', exact: true });
    await closePanel();
    await dragBy(dpad.locator('.controls-resize-handle'), 18, 18);
    assert.equal(await properties.isVisible(), false);
    await command('属性');
    const resizedWidth = Number(await dpadWidth.inputValue());
    assert.ok(resizedWidth > 0.16);
    await command('撤销');
    await command('属性');
    assert.equal(Number(await dpadWidth.inputValue()), 0.16);
    await command('重做');
    await command('属性');
    assert.equal(Number(await dpadWidth.inputValue()), resizedWidth);
    await closePanel();
    await capture('controls-world-editor');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await canvas.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-control-type="dpad"]');
      return (
        node &&
        Math.abs(node.getBoundingClientRect().width / 844 - parseFloat(node.style.height) / 100) <
          0.01
      );
    });
    await page.setViewportSize({ width: 932, height: 430 });
    await command('游戏界面');
    await openMenu();
    const scenePicker = menu.getByRole('group', { name: '预览场景' });
    const interfaceCanvas = canvas;
    await scenePicker.getByRole('button', { name: '背包', exact: true }).click();
    assert.equal(await interfaceCanvas.locator('.controls-art-slots.inventory > i').count(), 50);
    await closePanel();
    await capture('controls-inventory-editor');
    const coinAmmo = interfaceCanvas.getByRole('button', { name: '钱币与弹药', exact: true });
    const coinBounds = await coinAmmo.boundingBox();
    await page.mouse.click(
      coinBounds.x + coinBounds.width / 2,
      coinBounds.y + coinBounds.height / 2,
    );
    await properties.getByRole('heading', { name: '钱币与弹药', exact: true }).waitFor();
    assert.equal(
      await editor.getByRole('combobox', { name: '界面区域', exact: true }).inputValue(),
      'CoinAmmo',
    );
    await openMenu();
    await scenePicker.getByRole('button', { name: '制作', exact: true }).click();
    assert.equal(
      await interfaceCanvas.getByRole('button', { name: '制作区', exact: true }).count(),
      1,
    );
    assert.equal(
      await interfaceCanvas.getByRole('button', { name: '装备区', exact: true }).count(),
      0,
    );
    await scenePicker.getByRole('button', { name: '快捷栏', exact: true }).click();
    await command('属性');
    await editor.getByRole('combobox', { name: '快捷栏方向' }).selectOption('1');
    await closePanel();
    const hotbarPreview = interfaceCanvas.getByRole('button', { name: '快捷栏', exact: true });
    await dragBy(hotbarPreview, 25, 40);
    await dragBy(hotbarPreview.locator('.controls-resize-handle'), 20, 20);
    await command('属性');
    assert.ok(
      Number(await editor.getByRole('slider', { name: '区域大小', exact: true }).inputValue()) > 1,
    );
    await command('游戏控制');
    assert.equal(await dpad.count(), 1);
    await command('保存布局');
    await editor.waitFor({ state: 'hidden' });
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls.some(
          (call) =>
            call.method === 'controls.save' &&
            call.params.category === 'layout' &&
            call.params.settings.CustomPresets?.some((preset) =>
              preset?.Controls.some((control) => control.Launcher?.Data.name === '测试方向键'),
            ) &&
            call.params.settings.InterfaceLayout?.Regions.Hotbar?.CenterY > 0.12,
        ),
      ),
    );
    await openEditor();
    await command('游戏界面');
    await command('属性');
    assert.equal(await editor.getByRole('combobox', { name: '快捷栏方向' }).inputValue(), '1');
    await command('游戏控制');
    await command('属性');
    await editor.getByRole('combobox', { name: '选中控件' }).selectOption({ label: '测试方向键' });
    assert.equal(await editor.getByRole('combobox', { name: '方向键样式' }).inputValue(), 'ROUND');
    await editor.getByRole('textbox', { name: '控件名称' }).fill('未保存');
    await closePanel();
    await page.evaluate(() => window.dispatchEvent(new Event('launcher:back')));
    await editor.getByRole('button', { name: '放弃修改' }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.locator('#settings-tab-runtime').click();
    await page.getByRole('combobox', { name: '渲染器', exact: true }).click();
    await page.getByRole('option', { name: /GL4ES.*dev\.example\.renderer 1\.2/ }).click();
    await page.waitForFunction(
      () => window.nativeFixture.preferences.rendererPlugin === 'dev.example.renderer:gl4es',
    );
    assert.ok(
      await page.evaluate(() =>
        window.nativeCalls.some(
          (call) =>
            call.method === 'settings.save' &&
            call.params.preferences.rendererPlugin === 'dev.example.renderer:gl4es',
        ),
      ),
      'renderer selection is saved through the native settings bridge',
    );
    await page.getByRole('combobox', { name: '分辨率比例', exact: true }).click();
    await page.getByRole('option', { name: '75%', exact: true }).click();
    await page.waitForFunction(() => window.nativeFixture.preferences.renderScale === 75);
    await page.locator('#settings-tab-appearance').click();
    await page.getByRole('combobox', { name: '主题样式', exact: true }).click();
    await page.getByRole('option', { name: '泰拉风', exact: true }).click();
    await page.waitForFunction(() => window.nativeFixture.preferences.themeStyle === 'tml');
    assert.equal(await page.locator('html').getAttribute('data-skin'), 'tml');
    const checkDownloadTheme = async () => {
      await page.locator('.topbar [data-action=tasks]').click();
      const gogTask = page.locator('.download-card').filter({ hasText: 'GOG · Linux 游戏资源' });
      const listColors = await cardColors(gogTask);
      await gogTask.getByRole('button', { name: '查看下载窗口', exact: true }).click();
      assert.deepEqual(await cardColors(downloadWindow.locator('.download-card')), listColors);
      await page.keyboard.press('Escape');
      await downloadWindow.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      return listColors;
    };
    const tmlDownloadColors = await checkDownloadTheme();
    assert.equal(tmlDownloadColors[0], 'rgb(33, 43, 79)');
    assert.notDeepEqual(tmlDownloadColors, darkDownloadColors);
    await page.getByRole('button', { name: '图片背景', exact: true }).click();
    const imageBrowser = page.getByRole('dialog', { name: '选择文件', exact: true });
    await imageBrowser.locator('.file-entry').filter({ hasText: 'forest.png' }).click();
    await imageBrowser.getByRole('button', { name: '使用此图片', exact: true }).click();
    await imageBrowser.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.nativeFixture.preferences.background === 'custom');
    assert.equal(
      await page.locator('#background-file').count(),
      0,
      'Android does not expose a web/system file chooser',
    );
    await page.getByRole('combobox', { name: '主题样式', exact: true }).click();
    await page.getByRole('option', { name: '默认', exact: true }).click();
    await page.waitForFunction(() => window.nativeFixture.preferences.themeStyle === 'default');
    assert.equal(await page.locator('html').getAttribute('data-skin'), null);
    // Changing the skin does not change the independently saved dark/light theme.
    const defaultDownloadColors = await checkDownloadTheme();
    assert.equal(defaultDownloadColors[2], 'dark');
    assert.equal(await page.evaluate(() => window.nativeFixture.preferences.theme), 'dark');
    assert.notDeepEqual(defaultDownloadColors, tmlDownloadColors);
    assert.equal(
      await page.evaluate(() => window.nativeFixture.preferences.renderScale),
      75,
      'UI appearance saves do not overwrite game settings',
    );
    await page.getByRole('combobox', { name: '启动器方向', exact: true }).click();
    await page.getByRole('option', { name: '竖屏', exact: true }).click();
    await page.waitForFunction(() => window.nativeFixture.preferences.orientation === 'portrait');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.launch-button').innerText(), '启动游戏');
    await page.locator('.launch-button').click();
    await page.waitForFunction(() => window.nativeCalls.some((call) => call.method === 'launch'));
    await page.evaluate(() => window.dispatchEvent(new Event('launcher:game-returned')));
    await page.locator('.game-launch-screen').waitFor({ state: 'hidden' });
    await nav('settings').click();
    await page.locator('#settings-tab-about').click();
    assert.equal(await page.locator('#demo-toggle').count(), 0);
    await page.getByRole('button', { name: '查看日志', exact: true }).click();
    await page.getByText('[dotnet] 实际启动日志', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await nav('games').click();
    await page.getByRole('tab', { name: '添加游戏', exact: true }).click();
    const launchesBeforeConversion = await page.evaluate(() => {
      window.mobileTerrariaFixture = {
        status: 'unity',
        version: '1.4.5.8.6',
        apkCount: 1,
        targetTml: window.nativeFixture.tml,
      };
      return window.nativeCalls.filter((call) => call.method === 'launch').length;
    });
    await mobileTerraria.click();
    await mobileInspection.getByRole('button', { name: '转换资源', exact: true }).click();
    await mobileInspection.waitFor({ state: 'hidden' });
    await page.getByRole('region', { name: 'tModLoader 游戏状态' }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.nativeCalls.filter((call) => call.method === 'launch').length,
      ),
      launchesBeforeConversion,
    );
    await page.locator('.launch-button').click();
    await page.waitForFunction(
      (count) => window.nativeCalls.filter((call) => call.method === 'launch').length === count + 1,
      launchesBeforeConversion,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: native bridge fixture; file browser and detailed import failures; Steam/GOG/tModLoader download windows, minimize/reopen without duplicate downloads, Android Back, six phone sizes, cancellation/retry, retained results, and background success/failure without stealing focus; Steam login/Guard/library/download navigation; GOG versions; mods/packs/releases; settings and launch/logs. Fixture results do not establish real-device authentication or resource downloads.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
