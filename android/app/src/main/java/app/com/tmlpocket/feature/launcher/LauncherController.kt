package app.com.tmlpocket.feature.launcher

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import app.com.tmlpocket.core.runtime.AssetBootstrap
import app.com.tmlpocket.feature.files.FileBrowserAccess
import app.com.tmlpocket.feature.installation.GamePackageInstaller
import app.com.tmlpocket.feature.installation.MobileTerrariaPackage
import app.com.tmlpocket.feature.installation.MobileTerrariaConverter
import app.com.tmlpocket.feature.installation.PackageKind
import app.com.tmlpocket.feature.installation.TerrariaSource
import app.com.tmlpocket.feature.mods.ModRepository
import app.com.tmlpocket.feature.mods.ModRepository.Companion.strings
import app.com.tmlpocket.feature.mods.WorkshopContentInstaller
import app.com.tmlpocket.feature.patches.PatchRepository
import app.com.tmlpocket.feature.releases.TmlRelease
import app.com.tmlpocket.feature.releases.TmlReleaseClient
import app.com.tmlpocket.feature.renderers.AndroidRendererPluginPackageSource
import app.com.tmlpocket.feature.renderers.RendererPluginAssetStager
import app.com.tmlpocket.feature.renderers.RendererPluginOption
import app.com.tmlpocket.feature.renderers.RendererPluginRepository
import app.com.tmlpocket.feature.renderers.RendererSelection
import app.com.tmlpocket.feature.stores.SteamGameDetailsClient
import app.com.tmlpocket.feature.stores.StoreRepository
import java.io.File
import java.io.InterruptedIOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/** Serializes mutations and retains tasks without retaining an Activity/WebView. */
internal class LauncherController(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val installer = GamePackageInstaller(context.filesDir)
    private val mods = ModRepository(File(context.filesDir, "userdata"))
    private val mobileControls = MobileControlsSettings(File(context.filesDir, "userdata"))
    private var migratedTouchMod = false
    private val patches = PatchRepository(File(context.filesDir, "patches"))
    private val client = TmlReleaseClient()
    private val releases = linkedMapOf<Long, TmlRelease>()
    private val stores = StoreRepository(context)
    private val steamDetails = SteamGameDetailsClient(File(context.cacheDir, "steam-details"))
    private val detailsWorker = Executors.newSingleThreadExecutor()
    private val filesWorker = Executors.newSingleThreadExecutor()
    private val fileBrowser = FileBrowserAccess(context)
    val settings = LauncherSettings(context)
    private val rendererRepository = RendererPluginRepository(
        AndroidRendererPluginPackageSource(context),
        RendererPluginAssetStager(File(context.filesDir, "renderers")),
        android.os.Build.VERSION.SDK_INT,
        android.os.Build.SUPPORTED_ABIS.toList(),
    )
    private var cancellation = AtomicBoolean(false)
    @Volatile private var closed = false
    var observer: ((JSONObject) -> Unit)? = null
    var busy = false
        private set

    private var data =
        JSONObject().put("mods", JSONArray()).put("packs", JSONArray()).put("patches", JSONArray())
    private var message = "正在检查安装状态…"
    private var percent = -1
    private var error: String? = null
    private var retry: (() -> Unit)? = null
    private var method = "state"
    private var launchStage: String? = null
    private var lastProgressNanos = 0L
    private var storeState = JSONObject()
    @Volatile private var rendererOptions = emptyList<RendererPluginOption>()

    fun snapshot(): JSONObject =
        JSONObject(data.toString())
            .put("systemLocale", context.resources.configuration.locales[0].toLanguageTag())
            .put("busy", busy)
            .put("message", message)
            .put("progress", percent)
            .put("error", error ?: JSONObject.NULL)
            .put("retry", retry != null)
            .put("operation", method)
            .put("launchStage", launchStage ?: JSONObject.NULL)
            .put("preferences", settings.read())
            .put("renderers", rendererOptionsJson())
            .put("protocol", 1)

    fun resumeStores() {
        if (!closed) worker.execute { if (!closed) runCatching { stores.onResume() } }
    }

    fun refreshRendererCatalog() {
        if (!closed) worker.execute {
            val result = runCatching { rendererRepository.discover() }
            result.onSuccess { catalog ->
                rendererOptions = catalog.options
                if (catalog.diagnostics.isNotEmpty()) {
                    android.util.Log.w("tMLPocketRenderers", catalog.diagnostics.joinToString("; "))
                }
            }.onFailure { android.util.Log.e("tMLPocketRenderers", "Renderer discovery failed", it) }
            main.post { if (!closed) emit() }
        }
    }

    fun request(name: String, params: JSONObject, reply: (Result<Any>) -> Unit) {
        if (name in setOf("files.roots", "files.list", "files.image", "files.export", "mods.icons", "import")) {
            if (!closed)
                filesWorker.execute {
                    if (name == "import") {
                        val result = runCatching {
                            fileBrowser
                                .repository()
                                .selection(params.getString("kind"), params.getJSONArray("files"))
                        }
                        main.post {
                            if (!closed)
                                result.fold(
                                    { files ->
                                        importUris(
                                            params.getString("kind"),
                                            files.map { Uri.fromFile(it) },
                                            reply,
                                        )
                                    },
                                    { reply(Result.failure(it)) },
                                )
                        }
                    } else {
                        val result =
                            runCatching<Any> {
                                when (name) {
                                    "files.roots" -> fileBrowser.status()
                                    "files.list" -> fileBrowser.repository().list(params)
                                    "files.image" -> fileBrowser.image(params)
                                    "mods.icons" -> mods.icons(params.getJSONArray("ids").strings())
                                    else ->
                                        fileBrowser
                                            .repository()
                                            .export(
                                                params.getString("root"),
                                                params.optString("path"),
                                                params.getString("name"),
                                                params.getString("text"),
                                            )
                                }
                            }
                        main.post { if (!closed) reply(result) }
                    }
                }
            return
        }
        when (name) {
            "logs",
            "terraria.mobile.inspect",
            "store.steam.details" -> {
                if (!closed)
                    detailsWorker.execute {
                        val result = runCatching {
                            when (name) {
                                "logs" -> JSONObject().put("text", readLogs())
                                "terraria.mobile.inspect" -> MobileTerrariaPackage.inspect(context)
                                    .put("targetTml", MobileTerrariaPackage.targetTml(context) ?: JSONObject.NULL)
                                else -> steamDetails.details(params.optBoolean("refresh"))
                            }
                        }
                        main.post { if (!closed) reply(result) }
                    }
                return
            }
            "store.status" -> {
                if (busy) {
                    reply(Result.success(JSONObject(storeState.toString())))
                    return
                }
                worker.execute {
                    val result = runCatching { stores.request("status", JSONObject()) }
                    main.post {
                        if (!closed) {
                            (result.getOrNull() as? JSONObject)?.let { storeState = it }
                            reply(result)
                        }
                    }
                }
                return
            }
            "cancel" -> {
                cancellation.set(true)
                message = "正在取消…"
                emit()
                reply(Result.success(true))
                return
            }
            "settings.save" -> {
                reply(runCatching {
                    val patch = params.getJSONObject("preferences")
                    if (patch.has("rendererPlugin")) {
                        val identity = patch.getString("rendererPlugin")
                        require(RendererSelection.isAvailable(identity, rendererOptions.map { it.identity }.toSet())) {
                            "所选渲染器不可用，请刷新渲染器列表"
                        }
                    }
                    settings.save(patch)
                })
                emit()
                return
            }
            "retry" -> {
                val action = retry
                if (action == null) reply(Result.failure(IllegalStateException("没有可重试的任务")))
                else {
                    action()
                    reply(Result.success(true))
                }
                return
            }
        }
        if (busy) {
            if (name == "state") reply(Result.success(snapshot()))
            else reply(Result.failure(IllegalStateException("已有任务正在执行，请等待或取消")))
            return
        }
        if (
            name in
                setOf(
                    "download",
                    "versions.select",
                    "versions.uninstall",
                    "mods.enable",
                    "mods.delete",
                    "packs.apply",
                    "patches.toggle",
                    "patches.delete",
                    "workshop.query",
                    "workshop.details",
                    "workshop.download",
                    "controls.save",
                    "launch.check",
                    "terraria.mobile.convert",
                    "terraria.desktop.select",
                    "store.steam.download",
                    "store.gog.download",
                ) && gameRunning()
        ) {
            reply(Result.failure(IllegalStateException("游戏正在运行，请返回并关闭游戏后修改安装或模组")))
            return
        }
        execute(name, { request(name, params, {}) }, reply) { cancelled ->
            if (
                name in
                    setOf(
                        "download",
                        "workshop.download",
                        "store.steam.download",
                        "store.gog.download",
                    ) && settings.read().optBoolean("wifiOnly")
            ) {
                val network =
                    context.getSystemService(Context.CONNECTIVITY_SERVICE)
                        as android.net.ConnectivityManager
                require(!network.isActiveNetworkMetered) { "已启用仅在 Wi-Fi 下下载，请连接不计费网络或关闭此选项" }
            }
            when (name) {
                "controls.read" -> mobileControls.read()
                "controls.save" -> mobileControls.save(params)
                "store.status",
                "store.steam.login",
                "store.steam.guard",
                "store.steam.reconnect",
                "store.steam.probe",
                "store.steam.verify",
                "store.steam.logout",
                "store.gog.auth",
                "store.gog.login",
                "store.gog.logout",
                "store.gog.installers" ->
                    stores.request(name.removePrefix("store."), params, cancelled, ::progress)
                "store.steam.download",
                "store.gog.download" -> {
                    val archive =
                        stores.downloadedArchive(
                            stores.request(
                                name.removePrefix("store."),
                                params,
                                cancelled,
                                ::progress,
                            )
                        )
                    try {
                        installer.importPackage(
                            PackageKind.TERRARIA,
                            archive,
                            cancelled = cancelled,
                            progress = ::progress,
                            source =
                                if (name.contains("steam")) TerrariaSource.STEAM
                                else TerrariaSource.GOG,
                        )
                    } finally {
                        archive.delete()
                    }
                    true
                }
                "state",
                "refresh" -> {
                    if (!gameRunning()) installDefaultTml(cancelled)
                    null
                }
                "versions.select" -> {
                    installer.selectVersion(params.getString("id"))
                    true
                }
                "versions.uninstall" -> {
                    installer.uninstallVersion(params.getString("id"), cancelled, ::progress)
                    true
                }
                "releases" -> {
                    val page = client.releases(params.optInt("page", 1), cancelled)
                    page.releases.forEach { releases[it.id] = it }
                    JSONObject()
                        .put("hasMore", page.hasMore)
                        .put(
                            "releases",
                            JSONArray(
                                page.releases.map {
                                    JSONObject()
                                        .put("id", it.id.toString())
                                        .put("tag", it.tag)
                                        .put("name", it.name)
                                        .put("preview", it.preview)
                                        .put("size", it.size)
                                }
                            ),
                        )
                }
                "download" -> {
                    val release = releases[params.getString("id").toLong()] ?: error("请重新读取官方版本列表")
                    var last = 0L
                    val archive =
                        client.download(release, context.cacheDir, cancelled) { done, total ->
                            val now = System.nanoTime()
                            if (now - last > 150_000_000 || done == total) {
                                last = now
                                progress(
                                    "正在下载 ${release.tag} · ${done / 1048576} MB",
                                    if (total > 0) (done * 100 / total).toInt() else -1,
                                )
                            }
                        }
                    try {
                        installer.importPackage(
                            PackageKind.TMODLOADER,
                            archive,
                            release.tag,
                            cancelled,
                            ::progress,
                        )
                    } finally {
                        archive.delete()
                    }
                    true
                }
                "mods.enable" -> {
                    mods.setEnabled(
                        params.getJSONArray("ids").strings().toSet(),
                        params.getBoolean("enabled"),
                    )
                    true
                }
                "mods.delete" -> {
                    mods.delete(params.getString("id"))
                    true
                }
                "packs.save" -> mods.savePack(params.getString("name"))
                "packs.apply" -> {
                    mods.applyPack(params.getString("name"))
                    true
                }
                "packs.delete" -> {
                    mods.deletePack(params.getString("name"))
                    true
                }
                "packs.export" -> mods.packs()
                "patches.toggle" -> {
                    patches.toggle(
                        params.getString("id"),
                        params.getBoolean("enabled"),
                        installer.packageStatus(PackageKind.TMODLOADER),
                    )
                    true
                }
                "patches.delete" -> {
                    patches.delete(params.getString("id"))
                    true
                }
                "workshop.query",
                "workshop.details" -> stores.request(name, params, cancelled, ::progress)
                "workshop.download" -> {
                    val result = stores.request(name, params, cancelled, ::progress) as JSONObject
                    val root = File(context.cacheDir, "store-downloads").canonicalFile
                    val directory = File(result.getString("directory")).canonicalFile
                    val file = File(result.getString("file")).canonicalFile
                    require(directory.parentFile == root && file.parentFile == directory && file.isFile) {
                        "工坊暂存下载路径无效"
                    }
                    try {
                        require(result.getInt("appId") == params.getInt("appId") && result.getString("id") == params.getString("id")) {
                            "下载的工坊项目与请求不一致"
                        }
                        if (cancelled()) throw InterruptedIOException("已取消")
                        progress("正在安装工坊内容…", 95)
                        val modId = WorkshopContentInstaller(File(context.filesDir, "userdata"), mods)
                            .install(
                                result.getInt("appId"),
                                result.getString("id"),
                                params.optString("title", result.optString("fileName")),
                                file,
                                installer.packageStatus(PackageKind.TMODLOADER),
                            )
                        JSONObject().put("modId", modId ?: JSONObject.NULL)
                    } finally {
                        directory.deleteRecursively()
                    }
                }
                "storage" -> storage()
                "cache.clear" -> {
                    // Only launcher-owned temporary files; never WebView data, saves or mods.
                    context.cacheDir
                        .listFiles()
                        ?.filter {
                            it.isFile &&
                                (it.name.startsWith("package-") ||
                                    it.name.startsWith("tml-") ||
                                    it.name.startsWith("workshop-"))
                        }
                        ?.forEach { check(it.delete()) { "无法清理 ${it.name}" } }
                    storage()
                }
                "logs" -> JSONObject().put("text", readLogs())
                "terraria.desktop.select" -> {
                    installer.selectTerraria(android = false)
                    true
                }
                "terraria.mobile.convert" -> {
                    installDefaultTml(cancelled)
                    prepareMobileTerraria(cancelled)
                    true
                }
                "launch.check" -> {
                    launchProgress("resources", "正在检查游戏资源…")
                    installDefaultTml(cancelled)
                    val installed =
                        installer.installation() ?: error("请先导入 Terraria 资源与 tModLoader 发行包")
                    if (installed.terrariaSource == TerrariaSource.STEAM) {
                        launchProgress("ownership", "正在通过 Steam 验证 Terraria 所有权…")
                        check(stores.request("steam.verify", JSONObject(), cancelled) == true) {
                            "Steam 未能确认 Terraria 所有权，请登录拥有游戏的账户后重试"
                        }
                    }
                    check(!cancelled()) { "启动已取消" }
                    launchProgress("mods", "正在检查模组与补丁…")
                    AssetBootstrap.migrateTouchMod(context)
                    mods.validateForLaunch(installed.version)
                    val args =
                        settings.read().optJSONArray("launchArguments")?.strings().orEmpty() +
                            patches.arguments(installed.version)
                    PatchRepository.validateArguments(args)
                    check(!cancelled()) { "启动已取消" }
                    launchProgress("handoff", "正在进入游戏…")
                    JSONObject().put("arguments", JSONArray(args)).put("version", installed.version)
                }
                else -> error("未知启动器操作：$name")
            }
        }
    }

    fun importUris(kind: String, uris: List<Uri>, reply: (Result<Any>) -> Unit) {
        if (busy) {
            reply(Result.failure(IllegalStateException("已有任务正在执行")))
            return
        }
        if (gameRunning()) {
            reply(Result.failure(IllegalStateException("游戏正在运行，请关闭游戏后导入")))
            return
        }
        execute("import", { importUris(kind, uris, {}) }, reply) { cancelled ->
            require(
                uris.size in 1..100 &&
                    kind in
                        setOf(
                            "terraria",
                            "terraria-steam",
                            "terraria-gog",
                            "terraria-gog-zip",
                            "tml",
                            "mod",
                            "patch",
                            "pack",
                        )
            ) {
                "不支持的导入类型"
            }
            var inspection: JSONObject? = null
            uris.forEachIndexed { index, uri ->
                progress("正在读取文件 ${index + 1} / ${uris.size}…", -1)
                val file = File.createTempFile("package-", ".import", context.cacheDir)
                try {
                    val limit =
                        when (kind) {
                            "mod" -> 1024L * 1024 * 1024
                            "patch",
                            "pack" -> 1024L * 1024
                            else -> 8L * 1024 * 1024 * 1024
                        }
                    if (uri.scheme == "file") {
                        val sourceFile = File(requireNotNull(uri.path))
                        val rootSelection = fileBrowser.repository()
                        val valid = rootSelection.roots()
                        check(
                            (0 until valid.length()).any { index ->
                                val root = valid.getJSONObject(index)
                                val base = File(root.getString("path")).canonicalFile
                                val path = sourceFile.canonicalFile.toPath()
                                path.startsWith(base.toPath()) &&
                                    runCatching {
                                            rootSelection.resolve(
                                                root.getString("id"),
                                                base
                                                    .toPath()
                                                    .relativize(path)
                                                    .toString()
                                                    .replace('\\', '/'),
                                            )
                                        }
                                        .isSuccess
                            }
                        ) {
                            "所选文件不可访问，请重新选择"
                        }
                    }
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        file.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var copied = 0L
                            while (true) {
                                if (cancelled()) throw InterruptedIOException("已取消")
                                val count = input.read(buffer)
                                if (count < 0) break
                                copied += count
                                require(copied <= limit) { "文件超过导入上限" }
                                output.write(buffer, 0, count)
                            }
                        }
                    } ?: error("无法读取所选文件")
                    when (kind) {
                        "terraria",
                        "terraria-steam",
                        "tml" ->
                            installer.importPackage(
                                if (kind == "tml") PackageKind.TMODLOADER else PackageKind.TERRARIA,
                                file,
                                cancelled = cancelled,
                                progress = ::progress,
                            )
                        "terraria-gog-zip" -> {
                            inspection = java.util.zip.ZipFile(file).use { zip ->
                                val entries = zip.entries()
                                var count = 0
                                var content = false
                                var executable = false
                                var executableHash: String? = null
                                while (entries.hasMoreElements()) {
                                    if (cancelled()) throw InterruptedIOException("已取消")
                                    val entry = entries.nextElement()
                                    count++
                                    require(count <= 100_000) { "ZIP 包含过多文件" }
                                    val path = entry.name.replace(92.toChar(), '/').trimStart('/').lowercase(java.util.Locale.ROOT)
                                    if (path.startsWith("content/") || path.contains("/content/")) content = true
                                    if (!entry.isDirectory && (path == "terraria.exe" || path.endsWith("/terraria.exe"))) {
                                        executable = true
                                        require(executableHash == null) { "Multiple Terraria executables in ZIP" }
                                        val digest = java.security.MessageDigest.getInstance("SHA-256")
                                        zip.getInputStream(entry).use { input ->
                                            val buffer = ByteArray(64 * 1024)
                                            var total = 0L
                                            while (true) {
                                                if (cancelled()) throw InterruptedIOException("已取消")
                                                val n = input.read(buffer)
                                                if (n < 0) break
                                                total += n
                                                require(total <= 64L * 1024 * 1024) { "Terraria.exe exceeds inspection limit" }
                                                digest.update(buffer, 0, n)
                                            }
                                        }
                                        executableHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                                    }
                                }
                                JSONObject().put("entries", count).put("hasContent", content).put("hasExecutable", executable)
                                    .put("sha256", executableHash ?: "").put("referenceMatch", executableHash == "2d64ea3ad8bbcf209c9dcec1a074befe054c52b665cbf77023d15b92e7eec9c8")
                                    .put("message", if (content && executable) "SHA-256: $executableHash. Совпадение с предварительным образцом: ${executableHash == "2d64ea3ad8bbcf209c9dcec1a074befe054c52b665cbf77023d15b92e7eec9c8"}. Установка не выполнена." else "В ZIP не найдены одновременно Content и Terraria.exe.")
                            }
                        }
                        "terraria-gog" -> {
                            val archive = stores.importGog(file, cancelled, ::progress)
                            try {
                                installer.importPackage(
                                    PackageKind.TERRARIA,
                                    archive,
                                    cancelled = cancelled,
                                    progress = ::progress,
                                    source = TerrariaSource.GOG,
                                )
                            } finally {
                                archive.delete()
                            }
                        }
                        "mod" -> mods.importFile(file)
                        "patch" -> patches.importFile(file)
                        "pack" -> {
                            val text = file.readText().trim()
                            if (text.startsWith("[")) {
                                val displayName =
                                    (if (uri.scheme == "file") File(requireNotNull(uri.path)).name
                                        else
                                            context.contentResolver
                                                .query(
                                                    uri,
                                                    arrayOf(
                                                        android.provider.OpenableColumns
                                                            .DISPLAY_NAME
                                                    ),
                                                    null,
                                                    null,
                                                    null,
                                                )
                                                ?.use {
                                                    if (it.moveToFirst()) it.getString(0) else null
                                                })
                                        ?.substringBeforeLast('.')
                                        ?.take(80) ?: "导入的模组包"
                                mods.savePack(displayName, JSONArray(text).strings())
                            } else {
                                val pack = JSONObject(text)
                                mods.savePack(
                                    pack.getString("name"),
                                    pack.getJSONArray("mods").strings(),
                                )
                            }
                        }
                    }
                } finally {
                    file.delete()
                }
            }
            inspection ?: true
        }
    }

    fun close() {
        observer = null
        closed = true
        cancellation.set(true)
        worker.shutdownNow()
        detailsWorker.shutdownNow()
        filesWorker.shutdownNow()
    }

    private fun execute(
        name: String,
        again: () -> Unit,
        reply: (Result<Any>) -> Unit,
        action: (cancelled: () -> Boolean) -> Any?,
    ) {
        if (closed) return
        val startedAt = SystemClock.elapsedRealtime()
        Log.i("tMLPocketLauncher", "Operation started: $name")
        busy = true
        method = name
        launchStage = if (name == "launch.check") "resources" else null
        message = "正在处理…"
        percent = -1
        error = null
        retry = null
        lastProgressNanos = 0
        val token = AtomicBoolean(false)
        cancellation = token
        emit()
        worker.execute {
            var result = runCatching {
                action { token.get() || Thread.currentThread().isInterrupted }
            }
            val refreshed = runCatching { readState() }
            if (refreshed.isFailure && result.isSuccess)
                result = Result.failure(refreshed.exceptionOrNull()!!)
            val elapsed = SystemClock.elapsedRealtime() - startedAt
            val operationFailure = result.exceptionOrNull()
            when {
                token.get() -> Log.i("tMLPocketLauncher", "Operation cancelled: $name (${elapsed}ms)")
                operationFailure != null -> {
                    // Exception messages can contain account responses or credentials.
                    // Keep the type and call sites without logging request/response data.
                    val frames = operationFailure.stackTrace.take(12).joinToString("\n    at ")
                    Log.e("tMLPocketLauncher", "Operation failed: $name (${elapsed}ms), ${operationFailure.javaClass.name}\n    at $frames")
                }
                else -> Log.i("tMLPocketLauncher", "Operation completed: $name (${elapsed}ms)")
            }
            main.post {
                if (closed) return@post
                refreshed.getOrNull()?.let { data = it }
                busy = false
                val failure = result.exceptionOrNull()
                error =
                    when {
                        failure != null ->
                            failure.message?.takeIf { it.isNotBlank() }
                                ?: "操作失败（${failure.javaClass.simpleName}）"
                        token.get() -> "操作已取消"
                        else -> null
                    }
                retry =
                    if (
                        error != null &&
                            name !in setOf("state", "launch.check") &&
                            !name.startsWith("store.")
                    )
                        again
                    else null
                message = error ?: "操作完成"
                percent = if (error == null) 100 else -1
                emit()
                reply(
                    if (error == null) Result.success(result.getOrNull() ?: snapshot())
                    else Result.failure(IllegalStateException(error, failure))
                )
            }
        }
    }

    private fun installDefaultTml(cancelled: () -> Boolean) {
        installer.installDefaultTml(context.cacheDir, cancelled, ::progress) { destination ->
            val buffer = ByteArray(128 * 1024)
            context.assets.open("tmodloader-default/tModLoader.zip").use { input ->
                destination.outputStream().use { output ->
                    while (true) {
                        check(!cancelled()) { "内置 tModLoader 安装已取消" }
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                    }
                }
            }
        }
    }

    private fun readState(): JSONObject {
        if (!gameRunning() && !migratedTouchMod) {
            AssetBootstrap.migrateTouchMod(context)
            migratedTouchMod = true
        }
        val terraria = installer.selectedTerrariaStatus()
        val tml = installer.packageStatus(PackageKind.TMODLOADER)
        val runtime =
            runCatching {
                    context.assets.open("runtime/dotnet.tar.xz").close()
                    context.assets.open("launcher/manifest.json").close()
                    true
                }
                .getOrDefault(false)
        return JSONObject()
            .put("terraria", terraria ?: JSONObject.NULL)
            .put("terrariaSource", installer.terrariaSource()?.id ?: JSONObject.NULL)
            .put("desktopTerrariaSource", installer.desktopTerrariaSource()?.id ?: JSONObject.NULL)
            .put("tml", tml ?: JSONObject.NULL)
            .put(
                "installedVersions",
                JSONArray(installer.installedVersions().map {
                    JSONObject()
                        .put("id", it.id)
                        .put("version", it.version)
                        .put("active", it.active)
                        .put("available", it.available)
                }),
            )
            .put("ready", installer.installation() != null && runtime)
            .put("runtime", runtime)
            .put("mods", mods.list())
            .put("packs", mods.packs())
            .put("patches", patches.list())
            .put("appVersion", app.com.tmlpocket.BuildConfig.VERSION_NAME)
    }

    private fun prepareMobileTerraria(cancelled: () -> Boolean) {
        val target = MobileTerrariaPackage.targetTml(context)
            ?: error("此 APK 未包含 Terraria PE 转换器")
        val tml = installer.packageStatus(PackageKind.TMODLOADER)
        check(tml == target) { "Terraria PE 转换需要选择 tModLoader $target" }
        val info = MobileTerrariaPackage.installed(context)
            ?: error("请先安装 Terraria PE")
        val fingerprint = MobileTerrariaPackage.fingerprint(info)
        if (!installer.mobileTerrariaIsCurrent(fingerprint, target)) {
            installer.installMobileTerraria(
                info.versionName.orEmpty().ifBlank { info.longVersionCode.toString() },
                fingerprint,
                target,
                cancelled,
                ::progress,
            ) { destination ->
                MobileTerrariaConverter.convertInstalled(context, destination) { stage, current, total ->
                    if (cancelled()) return@convertInstalled false
                    val (label, value) = when (stage) {
                        "extract" -> "正在提取 Terraria PE 资源…" to 0
                        "assets" -> "正在转换贴图、字体和音效（$current/$total）…" to (5 + current * 55 / total)
                        "music" -> "正在转换音乐（$current/$total）…" to (60 + current * 29 / total)
                        else -> "正在校验转换资源…" to 90
                    }
                    progress(label, value)
                    true
                }
                check(MobileTerrariaPackage.installed(context)?.let(MobileTerrariaPackage::fingerprint) == fingerprint) {
                    "转换期间 Terraria PE 已更新，请重新转换"
                }
            }
        }
        check(!cancelled()) { "资源转换已取消" }
        installer.selectTerraria(android = true)
    }

    private fun storage(): JSONObject =
        JSONObject()
            .put("games", File(context.filesDir, "games").absolutePath)
            .put("userdata", File(context.filesDir, "userdata").absolutePath)
            .put("mods", File(context.filesDir, "userdata/Mods").absolutePath)
            .put("cache", context.cacheDir.absolutePath)
            .put("availableBytes", context.filesDir.usableSpace)
            .put(
                "cacheBytes",
                context.cacheDir
                    .listFiles()
                    ?.filter {
                        it.isFile &&
                            (it.name.startsWith("package-") ||
                                it.name.startsWith("tml-") ||
                                it.name.startsWith("workshop-"))
                    }
                    ?.sumOf { it.length() } ?: 0,
            )

    private fun readLogs(): String {
        val roots =
            listOf(File(context.filesDir, "userdata")) +
                File(context.filesDir, "games").listFiles().orEmpty().filter {
                    it.isDirectory && (it.name == "tmodloader" || it.name.startsWith("tmodloader-"))
                }
        val logs =
            roots.flatMap { root ->
                root
                    .walkTopDown()
                    .maxDepth(5)
                    .filter { it.isFile && it.name.endsWith(".log") }
                    .take(15)
                    .toList()
            }
        val crashReports = File(context.filesDir, "userdata/Logs/game-crashes").listFiles()
            ?.filter { it.isDirectory }
            ?.map { File(it, "report.log") }
            ?.filter { it.isFile }.orEmpty()
        return (logs + crashReports).distinct()
            .sortedByDescending { it.lastModified() }
            .take(5)
            .joinToString("\n\n") { file ->
                val tail =
                    java.io.RandomAccessFile(file, "r").use { input ->
                        input.seek(maxOf(0, input.length() - 30_000))
                        ByteArray((input.length() - input.filePointer).toInt())
                            .also(input::readFully)
                            .toString(Charsets.UTF_8)
                    }
                "--- ${file.name} ---\n$tail"
            }
            .ifBlank { "尚无启动日志。导入资源并启动游戏后可在这里查看。" }
    }

    private fun launchProgress(stage: String, text: String) {
        Log.i("tMLPocketLauncher", "Game launch stage: $stage")
        main.post {
            if (!closed) {
                launchStage = stage
                message = text
                percent = -1
                emit()
            }
        }
    }

    private fun progress(text: String, value: Int) {
        val now = System.nanoTime()
        if (value != 100 && now - lastProgressNanos < 100_000_000) return
        lastProgressNanos = now
        val translated =
            when {
                text == "Extracting package" -> "正在解压发行包…"
                text.startsWith("Extracting ") -> "正在解压：${text.removePrefix("Extracting ")}"
                text == "Validating package" -> "正在校验发行包…"
                text == "Installing package" -> "正在安装发行包…"
                text == "Package installed" -> "发行包已安装。"
                else -> text
            }
        main.post {
            if (!closed) {
                message = translated
                percent = value
                emit()
            }
        }
    }

    private fun emit() {
        observer?.invoke(snapshot())
    }

    private fun rendererOptionsJson(): JSONArray {
        val result = JSONArray()
            .put(JSONObject().put("identity", "native").put("packageName", "").put("packageVersion", "").put("rendererId", "native").put("displayName", "系统原生 OpenGL ES 3").put("description", "").put("backend", "native"))
            .put(JSONObject().put("identity", RendererSelection.VULKAN).put("packageName", "").put("packageVersion", "").put("rendererId", RendererSelection.VULKAN).put("displayName", "SDL GPU · Vulkan").put("description", "SDL2-compat + SDL3 GPU").put("backend", "vulkan"))
        rendererOptions.forEach { option ->
            result.put(JSONObject()
                .put("identity", option.identity)
                .put("packageName", option.packageName)
                .put("packageVersion", option.packageVersionName ?: "")
                .put("rendererId", option.rendererId)
                .put("displayName", option.displayName)
                .put("description", option.description)
                .put("backend", option.backend.id))
        }
        return result
    }

    private fun gameRunning(): Boolean =
        (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager)
            .runningAppProcesses
            ?.any { it.processName == context.packageName + ":game" } == true
}
