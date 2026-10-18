package dev.hermes.keepalive

import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The hold is two parts: the foreground service keeps the process alive and
 * unfrozen, and a headless JS task keeps React Native's timers firing (they
 * stop with the activity otherwise), so the socket's heartbeats, timeouts and
 * redials keep running while the app is out of sight.
 */
class KeepAliveModule : Module() {
  /** the headless task the hold runs under, while it runs */
  private var taskId: Int? = null

  override fun definition() = ModuleDefinition {
    Name("HermesKeepAlive")

    /** true once the hold is running; false where the system refuses it (a start from too deep in the background) */
    Function("start") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: Exception) {
        Log.w(TAG, "The system refused the background hold", error)
        return@Function false
      }
      (context as? ReactContext)?.let { react -> UiThreadUtil.runOnUiThread { startTask(react) } }
      true
    }

    Function("stop") {
      val context = appContext.reactContext
      context?.stopService(Intent(context, KeepAliveService::class.java))
      (context as? ReactContext)?.let { react -> UiThreadUtil.runOnUiThread { finishTask(react) } }
      Unit
    }
  }

  /** a refreshed line restarts the service, not the task */
  private fun startTask(react: ReactContext) {
    val tasks = HeadlessJsTaskContext.getInstance(react)
    if (taskId?.let(tasks::isTaskRunning) == true) return
    taskId = try {
      tasks.startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
    } catch (error: Exception) {
      Log.w(TAG, "Could not keep timers running in the background", error)
      null
    }
  }

  private fun finishTask(react: ReactContext) {
    val id = taskId ?: return
    taskId = null
    val tasks = HeadlessJsTaskContext.getInstance(react)
    if (tasks.isTaskRunning(id)) tasks.finishTask(id)
  }

  companion object {
    private const val TAG = "HermesKeepAlive"
    /** registered by modules/hermes-keep-alive/index.ts */
    const val TASK_KEY = "HermesKeepAlive"
  }
}
