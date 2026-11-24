package app.com.tmlpocket.feature.game

import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import app.com.tmlpocket.R
import app.com.tmlpocket.core.platform.AndroidBridge
import app.com.tmlpocket.core.runtime.GameRuntime
import app.com.tmlpocket.feature.game.startup.GameStartupOverlay
import app.com.tmlpocket.feature.launcher.LauncherSettings
import java.util.concurrent.CountDownLatch
import org.libsdl.app.SDLActivity
import org.libsdl.app.SDL

/** Owns the SDL process; installation and downloads stay in the launcher Activity. */
class GameActivity : SDLActivity() {
    private lateinit var startupOverlay: GameStartupOverlay
    @Volatile private var latestDetail = ""
    @Volatile private var startupVisible = true
    private var crashSession: String? = null
    @Volatile private var failed = false
    private var bridgeAttached = false
    private val failureDismissed = CountDownLatch(1)

    override fun getLibraries() =
        arrayOf("SDL3", "SDL2_compat", "FAudio_sdl3", "FNA3D_sdl3", "main")

    override fun onCreate(savedInstanceState: Bundle?) {
        crashSession = intent.getStringExtra("crashSession")
        crashSession?.let { session ->
            runCatching { GameCrashReports.started(this, session) }
                .onFailure { Log.e(TAG, "Could not initialize game crash journal", it) }
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, failure ->
                GameCrashReports.failed(this, session, failure)
                if (previous != null) previous.uncaughtException(thread, failure)
                else Process.killProcess(Process.myPid())
            }
        }
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        if (mBrokenLibraries) return
        createStartupOverlay()
        AndroidBridge.attach(this)
        bridgeAttached = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.decorView.setOnApplyWindowInsetsListener { view, insets ->
                AndroidBridge.postImeVisibility(insets.isVisible(WindowInsets.Type.ime()))
                view.onApplyWindowInsets(insets)
            }
            window.decorView.requestApplyInsets()
        }
        enterImmersiveMode()
        startupOverlay.resumeMotion()
    }

    override fun loadLibraries() {
        for (library in getLibraries()) {
            crashSession?.let { GameCrashReports.stage(this, it, "加载原生组件: $library") }
            try {
                SDL.loadLibrary(library, this)
            } catch (failure: Throwable) {
                failed = true
                crashSession?.let { GameCrashReports.failed(this, it, failure) }
                throw failure
            }
        }
    }

    // SDL's resizable desktop window and managed bridge must not re-enable sensor rotation.
    override fun setRequestedOrientation(requestedOrientation: Int) {
        super.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
    }

    override fun sendCommand(command: Int, data: Any?): Boolean =
        super.sendCommand(command, if (command == COMMAND_CHANGE_WINDOW_STYLE) 1 else data)

    // SDL enables text events during window creation, before a game text field is focused.
    override fun shouldShowTextInput(): Boolean = AndroidBridge.isImeRequestedVisible()

    fun hideGameKeyboard() {
        sendCommand(COMMAND_TEXTEDIT_HIDE, null)
    }

    fun updateStartupStatus(title: String, detail: String, progressPercent: Int) {
        latestDetail = detail
        crashSession?.let { GameCrashReports.stage(this, it, detail) }
        if (!::startupOverlay.isInitialized || isFinishing || isDestroyed) return
        if (!startupVisible) return
        startupOverlay.update(title, detail, progressPercent)
    }

    fun recordStartupStatus(detail: String) {
        latestDetail = detail
        crashSession?.let { GameCrashReports.stage(this, it, detail) }
    }

    fun hideStartupStatus() {
        crashSession?.let { GameCrashReports.firstFrame(this, it) }
        startupVisible = false
        if (::startupOverlay.isInitialized) startupOverlay.firstFrame {}
    }

    fun enterImmersiveMode() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN)
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
        }
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
    }

    override fun onPause() {
        if (::startupOverlay.isInitialized) startupOverlay.pauseMotion()
        if (bridgeAttached) AndroidBridge.postLifecycle(true)
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
        if (::startupOverlay.isInitialized) startupOverlay.resumeMotion()
        if (bridgeAttached) AndroidBridge.postLifecycle(false)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
        if (bridgeAttached) AndroidBridge.postFocus(hasFocus)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (bridgeAttached) AndroidBridge.postKey(event)
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("SDL handles the game back event")
    override fun onBackPressed() {
        if (::startupOverlay.isInitialized && startupOverlay.returnIfFailed()) return
        if (bridgeAttached) AndroidBridge.postBack()
        super.onBackPressed()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        AndroidBridge.postPermission(
            requestCode,
            grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED,
        )
    }

    override fun main() {
        try {
            GameRuntime.launch(
                this,
                getArguments() +
                    (intent.getStringArrayExtra("launcherArguments") ?: emptyArray()),
            )
            check(!startupVisible) { "游戏运行时在显示首帧前退出：$latestDetail" }
            crashSession?.let { GameCrashReports.normalExit(this, it) }
        } catch (failure: Throwable) {
            failed = true
            crashSession?.let { GameCrashReports.failed(this, it, failure) }
            Log.e(TAG, "Game launch failed", failure)
            runCatching {
                val directory = java.io.File(filesDir, "userdata/Logs").apply { mkdirs() }
                java.io
                    .File(directory, "launcher-startup.log")
                    .appendText("${java.util.Date()}\n${failure.stackTraceToString()}\n")
            }
            val dismissed = failureDismissed
            val detail = failure.message ?: latestDetail
            Handler(Looper.getMainLooper()).post {
                if (isFinishing || isDestroyed || !::startupOverlay.isInitialized) dismissed.countDown()
                else {
                    startupVisible = true
                    startupOverlay.failed(detail) {
                        dismissed.countDown()
                        finish()
                    }
                }
            }
            try {
                dismissed.await()
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    override fun onDestroy() {
        // Release the SDL thread before SDLActivity waits for it during teardown.
        failureDismissed.countDown()
        if (!failed) crashSession?.let { GameCrashReports.normalExit(this, it) }
        if (::startupOverlay.isInitialized) startupOverlay.release()
        if (bridgeAttached) AndroidBridge.detach(this)
        super.onDestroy()
        // CoreCLR and SDL cannot be initialized twice in this process.
        Handler(Looper.getMainLooper()).postDelayed({ Process.killProcess(Process.myPid()) }, 100)
    }

    private fun createStartupOverlay() {
        startupOverlay =
            GameStartupOverlay(
                this,
                intent.getStringExtra("tmlVersion").orEmpty(),
                LauncherSettings(this).read().optBoolean("motion", true),
            )
        addContentView(startupOverlay, FrameLayout.LayoutParams(-1, -1))
        val strings = LauncherSettings(this).localizedContext()
        updateStartupStatus(
            strings.getString(R.string.launch_starting_tml),
            strings.getString(R.string.launch_prepare),
            -1,
        )
    }

    companion object {
        private const val TAG = "tMLPocketCoreClr"
    }
}
