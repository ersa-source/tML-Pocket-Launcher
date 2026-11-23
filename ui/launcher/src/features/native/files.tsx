import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton } from '../../components/ui';
import { useTranslation } from '../../i18n';
import { Select } from '../../components/form-controls';
import { nativeRequest } from '../../native/bridge';
import { useLauncher } from '../../state/launcher';

export interface FileSelection {
  root: string;
  path: string;
}
export type FileKind =
  | 'terraria-steam'
  | 'terraria-gog'
  | 'terraria-gog-zip'
  | 'tml'
  | 'mod'
  | 'patch'
  | 'pack'
  | 'image'
  | 'export';
interface FileRoot {
  id: string;
  label: string;
  path: string;
}
interface Access {
  granted: boolean;
  roots: FileRoot[];
  restricted: string;
}
interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: number;
}
interface Listing {
  entries: FileEntry[];
  total: number;
  hasMore: boolean;
}
interface BrowseOptions {
  kind: FileKind;
  name?: string;
  choose: (
    files: FileSelection[],
    destination: FileSelection & { name: string },
  ) => Promise<unknown>;
  complete?: (result: unknown) => void;
  failed?: (failure: unknown) => void;
}
const labels: Record<FileKind, string> = {
  'terraria-steam': 'Steam 资源 · ZIP',
  'terraria-gog': 'GOG 安装包 · .sh',
  'terraria-gog-zip': 'GOG Windows ZIP',
  tml: 'tModLoader · ZIP',
  mod: '模组 · .tmod',
  patch: '补丁 · JSON',
  pack: '模组包 · JSON',
  image: '背景 · PNG / JPG / WebP',
  export: '导出模组包 · JSON',
};
const fileKey = (file: FileSelection) => JSON.stringify([file.root, file.path]);
const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`;

export function useNativeFileBrowser() {
  const { t } = useTranslation();
  const { openDialog, closeDialog, notify } = useLauncher();
  const browse = (options: BrowseOptions) =>
    openDialog({
      title: options.kind === 'export' ? t('保存文件') : t('选择文件'),
      description: t(labels[options.kind]),
      drawer: true,
      surface: 'files',
      body: (
        <NativeFileBrowser
          options={options}
          done={(result) => {
            closeDialog(false);
            options.complete?.(result);
          }}
          cancel={() => closeDialog()}
        />
      ),
    });
  const exportJson = (name: string, text: string) =>
    browse({
      kind: 'export',
      name: name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.json',
      choose: (_, destination) => nativeRequest('files.export', { ...destination, text }),
      complete: () => notify(t('模组包已保存。')),
    });
  return { browse, exportJson };
}

function NativeFileBrowser({
  options,
  done,
  cancel,
}: {
  options: BrowseOptions;
  done: (result: unknown) => void;
  cancel: () => void;
}) {
  const { t, locale } = useTranslation();
  const { nativeState } = useLauncher();
  const [access, setAccess] = useState<Access | null>(null);
  const [location, setLocation] = useState<FileSelection | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState(false);
  const [sort, setSort] = useState('name');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Map<string, FileSelection>>(new Map());
  const [name, setName] = useState(options.name || 'mod-pack.json');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  const roots = useCallback(async () => {
    try {
      const next = await nativeRequest<Access>('files.roots');
      if (!alive.current) return;
      setAccess(next);
      setSelected(new Map());
      setLocation((current) =>
        current && next.roots.some((root) => root.id === current.root)
          ? current
          : next.roots.some((root) => root.id === 'storage')
            ? { root: 'storage', path: '' }
            : next.roots[0]
              ? { root: next.roots[0].id, path: '' }
              : null,
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    void roots();
    const resume = () => void roots();
    window.addEventListener('launcher:files-resume', resume);
    return () => window.removeEventListener('launcher:files-resume', resume);
  }, [roots]);
  useEffect(() => {
    if (!location) return;
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    const timer = setTimeout(
      () => {
        void nativeRequest<Listing>('files.list', {
          ...location,
          kind: options.kind,
          query,
          sort,
          offset,
        })
          .then((value) => {
            if (alive.current && request === sequence.current) setListing(value);
          })
          .catch((failure: Error) => {
            if (alive.current && request === sequence.current) {
              setError(failure.message);
              setListing(null);
            }
          })
          .finally(() => {
            if (alive.current && request === sequence.current) setLoading(false);
          });
      },
      query ? 160 : 0,
    );
    return () => {
      clearTimeout(timer);
      if (sequence.current === request) sequence.current++;
    };
  }, [location, options.kind, query, sort, offset, revision]);
  const go = (root: string, path: string) => {
    setLocation({ root, path });
    setQuery('');
    setOffset(0);
    setListing(null);
  };
  const choose = (entry: FileEntry) => {
    if (!location || pending) return;
    if (entry.directory) {
      go(location.root, entry.path);
      return;
    }
    if (options.kind === 'export') {
      setName(entry.name);
      return;
    }
    const file = { root: location.root, path: entry.path },
      key = fileKey(file);
    setSelected((previous) => {
      const next = options.kind === 'mod' ? new Map(previous) : new Map<string, FileSelection>();
      if (previous.has(key)) next.delete(key);
      else if (next.size < 100) next.set(key, file);
      return next;
    });
  };
  const confirm = async () => {
    if (!location || loading || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await options.choose([...selected.values()], {
        ...location,
        name: name.trim(),
      });
      if (alive.current) done(result);
    } catch (failure) {
      if (alive.current) {
        setPending(false);
        if (options.failed) options.failed(failure);
        else setError((failure as Error).message);
      }
    }
  };
  const root = access?.roots.find((item) => item.id === location?.root);
  const segments = location?.path.split('/').filter(Boolean) || [];
  const formatMismatch = /^文件格式不匹配：([\s\S]+)$/.exec(error);
  const importProgress = nativeState?.message.match(/^正在读取文件 (\d+) \/ (\d+)…$/);
  return (
    <div className="file-browser" aria-busy={loading || pending}>
      <div className="file-main">
        <div className="file-toolbar">
          <div className="file-pathbar">
            <div className="file-locations">
              <Select
                label={t('存储位置')}
                value={
                  location?.root === 'storage' && location.path === 'Download'
                    ? '@downloads'
                    : location?.root === 'storage' && location.path === 'Documents'
                      ? '@documents'
                      : location?.root || ''
                }
                options={[
                  ...(access?.roots.map((item) => {
                    const volume = /^外部存储 (\d+)$/.exec(item.label);
                    return [
                      item.id,
                      volume ? t('外部存储 {number}', { number: volume[1] }) : t(item.label),
                    ] as const;
                  }) || []),
                  ...(access?.granted
                    ? ([
                        ['@downloads', t('下载目录')],
                        ['@documents', t('文档目录')],
                      ] as const)
                    : []),
                ]}
                onChange={(value) =>
                  value === '@downloads'
                    ? go('storage', 'Download')
                    : value === '@documents'
                      ? go('storage', 'Documents')
                      : go(value, '')
                }
              />
            </div>
            <IconButton
              symbol="arrow"
              label={t('上一级目录')}
              disabled={pending || !segments.length}
              onClick={() => location && go(location.root, segments.slice(0, -1).join('/'))}
            />
            <nav aria-label={t('文件路径')}>
              {!segments.length && <small>{t('根目录')}</small>}
              {segments.map((part, index) => (
                <span key={segments.slice(0, index + 1).join('/')}>
                  <span aria-hidden="true">/</span>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      location && go(location.root, segments.slice(0, index + 1).join('/'))
                    }
                  >
                    {part}
                  </Button>
                </span>
              ))}
            </nav>
            <IconButton
              symbol="info"
              label={t('存储说明')}
              aria-expanded={info}
              onClick={() => setInfo((value) => !value)}
            />
            <IconButton
              symbol="refresh"
              label={t('刷新文件')}
              disabled={pending || loading}
              onClick={() => setRevision((value) => value + 1)}
            />
          </div>
          <div className="file-tools">
            <label>
              <Icon name="search" />
              <input
                aria-label={t('搜索当前目录')}
                placeholder={t('搜索当前目录')}
                value={query}
                disabled={pending}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <Select
              label={t('文件排序')}
              value={sort}
              onChange={(value) => {
                setSort(value);
                setOffset(0);
              }}
              options={[
                ['name', t('名称')],
                ['modified', t('最近修改')],
                ['size', t('文件大小')],
              ]}
            />
          </div>
        </div>
        {access && !access.granted && (
          <div className="file-access">
            <small>{t('需要授权才能浏览手机共享文件')}</small>
            <Button
              disabled={pending}
              onClick={() =>
                void nativeRequest('files.permission').catch((failure: Error) =>
                  setError(failure.message),
                )
              }
            >
              {t('授予文件访问权限')}
            </Button>
          </div>
        )}
        {info && (
          <p className="file-hint">
            {access?.restricted && t(access.restricted)}
            {root?.id === 'launcher' && <span>{t('当前目录：{path}', { path: root.path })}</span>}
          </p>
        )}
        {error && (
          <div className="file-error" role="alert">
            {formatMismatch ? t('文件格式不匹配：{name}', { name: formatMismatch[1] }) : t(error)}
            <Button onClick={() => void roots()} disabled={pending}>
              {t('重新读取')}
            </Button>
          </div>
        )}
        <div className="file-list" aria-label={t('文件列表')}>
          {loading ? (
            <p className="file-empty" role="status">
              {t('正在读取目录…')}
            </p>
          ) : !listing?.entries.length ? (
            <p className="file-empty">
              {error
                ? t('暂时无法显示文件')
                : query
                  ? t('当前目录中没有匹配项')
                  : t('当前目录没有支持的文件')}
              <small>
                {t(labels[options.kind])}
                {options.kind === 'mod' ? t(' · 可多选，最多 100 个') : ''}
              </small>
            </p>
          ) : (
            listing.entries.map((entry) => {
              const checked =
                !!location && selected.has(fileKey({ root: location.root, path: entry.path }));
              return (
                <Button
                  key={entry.path}
                  className={`file-entry ${checked ? 'selected' : ''}`}
                  disabled={pending}
                  aria-pressed={entry.directory || options.kind === 'export' ? undefined : checked}
                  onClick={() => choose(entry)}
                >
                  <span className={`file-entry-icon ${entry.directory ? 'directory' : ''}`}>
                    <Icon
                      name={
                        entry.directory ? 'folder' : options.kind === 'image' ? 'image' : 'file'
                      }
                    />
                  </span>
                  <span className="file-entry-copy">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.directory ? t('文件夹') : bytes(entry.size)}
                      {entry.modified > 0
                        ? ` · ${new Date(entry.modified).toLocaleDateString(locale)}`
                        : ''}
                    </small>
                  </span>
                  <Icon name={entry.directory ? 'chevron' : checked ? 'check' : 'plus'} />
                </Button>
              );
            })
          )}
        </div>
        {options.kind === 'export' && (
          <label className="file-save-name">
            {t('文件名')}
            <input
              aria-label={t('导出文件名')}
              value={name}
              maxLength={128}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {pending && nativeState?.busy && (
          <p className="file-progress" role="status">
            {importProgress
              ? t('正在读取文件 {current} / {total}…', {
                  current: importProgress[1],
                  total: importProgress[2],
                })
              : t(nativeState.message)}
            {nativeState.progress >= 0 ? ` · ${nativeState.progress}%` : ''}
          </p>
        )}
        <div className="file-confirm">
          <div className="file-summary" role="status">
            <span>
              {selected.size
                ? t('已选 {count} 个', { count: selected.size })
                : listing
                  ? t('{count} 项', { count: listing.total })
                  : t('读取中')}
            </span>
            {selected.size > 0 && (
              <IconButton
                symbol="close"
                label={t('清空选择')}
                disabled={pending}
                onClick={() => setSelected(new Map())}
              />
            )}
          </div>
          {listing && listing.total > 100 && (
            <div className="file-pages">
              <IconButton
                symbol="arrow"
                label={t('上一页文件')}
                disabled={pending || loading || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 100))}
              />
              <IconButton
                symbol="arrow"
                label={t('下一页文件')}
                disabled={pending || loading || !listing.hasMore}
                onClick={() => setOffset((value) => value + 100)}
              />
            </div>
          )}
          <Button
            disabled={pending && !nativeState?.busy}
            onClick={pending ? () => void nativeRequest('cancel') : cancel}
          >
            {pending ? t('取消任务') : t('取消')}
          </Button>
          <Button
            variant="primary"
            disabled={
              pending ||
              loading ||
              !location ||
              (options.kind === 'export' ? !name.trim() : selected.size === 0)
            }
            onClick={() => void confirm()}
          >
            {pending
              ? t('正在处理…')
              : options.kind === 'export'
                ? t('保存到此目录')
                : options.kind === 'image'
                  ? t('使用此图片')
                  : selected.size
                    ? t('导入 {count} 个文件', { count: selected.size })
                    : t('导入')}
          </Button>
        </div>
      </div>
    </div>
  );
}
