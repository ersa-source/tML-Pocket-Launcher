import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { useTranslation } from '../../i18n';
import { useLauncher, type LauncherContextValue } from '../../state/launcher';
import { nativeRequest } from '../../native/bridge';
import { NativeGogPanel } from './gog';
import { useSteam } from './steam/state';
import { useNativeFileBrowser } from './files';
import { NativeVersionManager } from './versions';
import { NativeAcquireAction } from './controls';

export function useNativeActions(launcher: LauncherContextValue) {
  const { t } = useTranslation();
  const { openDialog, closeDialog, navigate, notify, openWorkspace } = launcher;
  const { openSteam } = useSteam();
  const { browse } = useNativeFileBrowser();
  const notice = (title: string, description: string, body?: React.ReactNode) =>
    openDialog({ title, description, body });
  const run = (method: string, params: object = {}) => {
    closeDialog(false);
    void nativeRequest(method, params).catch((error: Error) =>
      notice(t('操作未完成'), error.message),
    );
  };
  const tasks = () => openWorkspace('downloads');
  const versions = () => openWorkspace('resource-versions');
  const importFile = (
    kind: 'terraria-steam' | 'terraria-gog' | 'terraria-gog-zip' | 'tml' | 'mod' | 'patch' | 'pack',
  ) => {
    browse({
      kind,
      choose: (files) => nativeRequest('import', { kind, files }),
      failed: (failure) =>
        openDialog({
          title: t('导入失败'),
          description: t('无法导入所选文件，请查看具体原因后重新选择。'),
          body: (
            <pre className="native-log" role="alert" tabIndex={0}>
              {failure instanceof Error && failure.message.trim()
                ? failure.message
                : t('操作失败，未提供错误详情。')}
            </pre>
          ),
          actions: (
            <>
              <Button onClick={() => closeDialog()}>{t('关闭')}</Button>
              <Button onClick={() => importFile(kind)}>{t('重新选择')}</Button>
            </>
          ),
        }),
      complete: (imported) => {
        if (!imported) return;
        if (kind === 'terraria-gog-zip') {
          const report = imported as { entries?: number; hasContent?: boolean; hasExecutable?: boolean; message?: string };
          openDialog({ title: 'Диагностика Terraria ZIP', description: report.message || 'Проверка завершена.', body: <p>{`Файлов: ${report.entries ?? 0}; Content: ${report.hasContent ? 'найден' : 'не найден'}; Terraria.exe: ${report.hasExecutable ? 'найден' : 'не найден'}.`}</p> });
        } else if (kind === 'terraria-steam') {
          openDialog({
            title: t('Steam 资源已导入'),
            description: t(
              '启动前需要登录拥有 Terraria 的 Steam 账户。每次启动都会在线验证游戏所有权。',
            ),
            actions: (
              <Button
                onClick={() => {
                  closeDialog(false);
                  openSteam();
                }}
              >
                {t('前往 Steam')}
              </Button>
            ),
          });
        } else
          notify(
            kind === 'terraria-gog'
              ? t('GOG 资源已导入并校验，无需登录即可启动。')
              : t('文件已导入并校验。'),
            '配置',
          );
      },
    });
  };
  const importInfo = (kind: 'terraria' | 'tml' | 'mod' | 'patch' | 'pack') => {
    if (kind !== 'terraria') {
      importFile(kind);
      return;
    }
    openDialog({
      title: t('导入 Terraria 资源'),
      description: t('选择资源来源。安装时保留模组与存档。'),
      body: (
        <div className="native-stack">
          <div className="resource-row">
            <div className="resource-copy">
              <h3>Steam · ZIP</h3>
              <p>{t('启动前登录 Steam，并在线验证账户拥有 Terraria。')}</p>
            </div>
            <Button onClick={() => importFile('terraria-steam')}>{t('选择 ZIP')}</Button>
          </div>

          <div className="resource-row">
            <div className="resource-copy">
              <h3>GOG · Linux .sh</h3>
              <p>{t('导入离线安装包，无需登录或验证游戏所有权。')}</p>
            </div>
            <Button onClick={() => importFile('terraria-gog')}>{t('选择 .sh')}</Button>
          </div>
        </div>
      ),
    });
  };
  const accounts = (platform: 'steam' | 'gog') =>
    platform === 'steam'
      ? openSteam()
      : openDialog({
          title: t('GOG 登录与下载'),
          description: t(
            '登录拥有 Terraria 的账户，下载并校验游戏资源。安装时保留现有模组与存档。',
          ),
          body: <NativeGogPanel />,
          drawer: true,
        });
  const addMods = () =>
    openDialog({
      title: t('添加模组'),
      description: t('选择获取方式。安装后可在「已安装」中管理启用状态。'),
      body: (
        <div className="native-acquire-options">
          <NativeAcquireAction
            title={t('下载模组')}
            description={t('进入 Steam 创意工坊下载中心')}
            symbol="download"
            onClick={() => openWorkspace('resource-mods')}
          />
          <NativeAcquireAction
            title={t('导入 .tmod')}
            description={t('选择本地模组文件，支持多选')}
            symbol="folder"
            onClick={() => importInfo('mod')}
          />
        </div>
      ),
    });
  const instances = () =>
    openDialog({
      title: t('已安装版本'),
      description: t(
        '不同 tML 版本独立安装。选择下次启动版本，或卸载指定版本。存档、模组与 Terraria 资源共用并保留。',
      ),
      body: <NativeVersionManager />,
      actions: (
        <>
          <Button onClick={versions}>{t('下载版本')}</Button>
          <Button onClick={() => importInfo('tml')}>{t('导入 ZIP')}</Button>
        </>
      ),
      drawer: true,
    });
  const environment = () => {
    void nativeRequest('refresh')
      .then(() => {
        openDialog({
          title: t('运行环境检查'),
          description: t('根据设备中实际安装的资源检查。'),
          body: <NativeEnvironment />,
        });
      })
      .catch((error: Error) => notice(t('检查失败'), error.message));
  };
  const showInfo = (id: string) => {
    if (id === 'logs')
      openDialog({
        title: t('诊断日志'),
        description: t('读取本机最近的运行日志。'),
        body: <><Button onClick={() => importFile('terraria-gog-zip')}>Проверить Terraria ZIP</Button><NativeLogs /></>,
        drawer: true,
      });
    else if (['storage-paths', 'mod-folder', 'cache'].includes(id))
      openDialog({
        title: id === 'cache' ? t('缓存管理') : t('数据目录'),
        description: t('数据保存在应用专用目录，重新安装游戏发行包不会删除模组和存档。'),
        body: <NativeStorage clear={id === 'cache'} />,
        drawer: true,
      });
    else if (id === 'launch-args')
      openDialog({
        title: t('启动参数'),
        description: t('每行一个参数，下一次启动生效。数据目录由启动器管理。'),
        body: <NativeArguments />,
        drawer: true,
      });
    else if (id === 'controls-layout')
      notice(
        t('触控布局'),
        t('在启动器的「设置 → 触控与输入」编辑控制和界面布局。游戏内也可以继续调整。'),
      );
    else if (id === 'licenses')
      openDialog({
        title: t('开源与许可'),
        description: t(
          'React、Motion、Radix、Animate UI、Inspira UI、AndroidX WebKit、SteamKit2 与游戏运行依赖。',
        ),
        body: (
          <>
            <p>{t('Animate UI: MIT + Commons Clause。')}</p>
            <p>{t('Inspira UI: MIT。')}</p>
            <p>{t('SteamKit2: LGPL-2.1-only。未修改的独立程序集，源码来自 SteamRE/SteamKit。')}</p>
            <p>
              {t(
                'RotatingartLauncher 触摸、显示、帧率、控制台与联机适配：GPL-3.0，源码位于 external/tML-Pocket-Patches。MobileJoystick 作者为 yu，游戏补丁源码和素材来源见 managed/MobileLauncher.Controls。',
              )}
            </p>
            <p>{t('完整许可文件随 APK 提供。')}</p>
          </>
        ),
      });
    else notice(t('启动器'), t('请从相应页面执行操作。'));
  };
  return {
    notice,
    tasks,
    versions,
    importInfo,
    accounts,
    addMods,
    instances,
    environment,
    showInfo,
    launch: () => run('launch'),
    startTask: () => {
      navigate('games');
      versions();
    },
  };
}

function NativeEnvironment() {
  const { t } = useTranslation();
  const { nativeState: state } = useLauncher();
  return (
    <dl className="detail-list">
      <dt>Terraria</dt>
      <dd>{state?.terraria || t('未安装或校验未通过')}</dd>
      <dt>tModLoader</dt>
      <dd>{state?.tml || t('未安装或校验未通过')}</dd>
      <dt>{t('Android 运行时')}</dt>
      <dd>{state?.runtime ? t('已随 APK 提供') : t('运行时资产缺失')}</dd>
      <dt>{t('启动')}</dt>
      <dd>{state?.ready ? t('资源已就绪，启动时再次检查依赖') : t('请先完成资源准备')}</dd>
    </dl>
  );
}
function NativeLogs() {
  const { t } = useTranslation();
  const { notify } = useLauncher();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void nativeRequest<{ text: string }>('logs')
      .then((data) => setText(data.text))
      .catch((error: Error) => setText(error.message));
  }, []);
  return (
    <>
      <pre className="native-log">{text ?? t('正在读取…')}</pre>
      <Button
        onClick={() =>
          void nativeRequest('share', { text: text ?? '正在读取…' }).catch((error: Error) =>
            notify(error.message),
          )
        }
      >
        {t('分享日志')}
      </Button>
    </>
  );
}
const STORAGE_LABELS: Readonly<Record<string, string>> = {
  games: '发行包',
  userdata: '用户数据',
  mods: '模组',
  cache: '下载缓存',
  availableBytes: '可用空间',
  cacheBytes: '可清理缓存',
};

function NativeStorage({ clear }: { clear: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Record<string, string | number>>({});
  const [error, setError] = useState('');
  const read = (method = 'storage') =>
    void nativeRequest<Record<string, string | number>>(method)
      .then(setData)
      .catch((failure: Error) => setError(failure.message));
  useEffect(() => {
    read();
  }, []);
  return (
    <>
      <dl className="detail-list">
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <dt>{Object.hasOwn(STORAGE_LABELS, key) ? t(STORAGE_LABELS[key]) : key}</dt>
            <dd>{typeof value === 'number' ? `${(value / 1048576).toFixed(1)} MB` : value}</dd>
          </div>
        ))}
      </dl>
      {error && <p role="alert">{error}</p>}
      {clear && <Button onClick={() => read('cache.clear')}>{t('清理下载临时文件')}</Button>}
    </>
  );
}
function NativeArguments() {
  const { t } = useTranslation();
  const { nativeState, notify, closeDialog } = useLauncher();
  const [value, setValue] = useState(nativeState?.preferences.launchArguments?.join('\n') || '');
  return (
    <>
      <textarea
        aria-label={t('启动参数')}
        className="native-textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        variant="primary"
        onClick={() =>
          void nativeRequest('settings.save', {
            preferences: {
              launchArguments: value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            },
          })
            .then(() => {
              notify(t('启动参数已保存。'));
              closeDialog();
            })
            .catch((error: Error) => notify(error.message))
        }
      >
        {t('保存')}
      </Button>
    </>
  );
}
