package dev.hermes.assistant

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The card's handle on its window and on the assistant role: close the card, hand off to the app,
 * wait for an unlock, read and change who the phone's assistant is, and the edge glow view.
 */
class AssistantModule : Module() {
  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("HermesAssistant")

    Events(SUMMON)

    OnStartObserving(SUMMON) {
      AssistantActivity.onSummon = { sendEvent(SUMMON) }
    }

    OnStopObserving(SUMMON) {
      AssistantActivity.onSummon = null
    }

    /** true while Hermes holds the phone's assistant role */
    Function("isDefaultAssistant") {
      val context = context ?: return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val roles = context.getSystemService(RoleManager::class.java)
        return@Function roles?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
      }
      Settings.Secure.getString(context.contentResolver, "voice_interaction_service")?.startsWith("${context.packageName}/") == true
    }

    /** the system's digital assistant picker; an app cannot take the assistant role itself */
    Function("openAssistantSettings") {
      val context = context ?: return@Function false
      val screens = listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_SETTINGS)
      screens.any { action ->
        try {
          context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }

    /** resolves true once the phone is unlocked, false when the reader backed out of the unlock */
    AsyncFunction("whenUnlocked") { promise: Promise ->
      val activity = AssistantActivity.current?.get() ?: return@AsyncFunction promise.resolve(true)
      activity.runOnUiThread { activity.whenUnlocked { promise.resolve(it) } }
    }

    /** closes the card; its exit has already played in JS */
    Function("dismiss") {
      val activity = AssistantActivity.current?.get() ?: return@Function Unit
      activity.runOnUiThread { activity.finish() }
    }

    /** brings the app forward, showing the chat the card opened, and closes the card */
    Function("openApp") {
      val activity = AssistantActivity.current?.get() ?: return@Function false
      val launch = activity.packageManager.getLaunchIntentForPackage(activity.packageName) ?: return@Function false
      activity.runOnUiThread {
        activity.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        activity.finish()
      }
      true
    }

    View(AssistantGlowView::class) {
      Prop("level") { view: AssistantGlowView, level: Double -> view.setLevel(level.toFloat()) }
      Prop("phase") { view: AssistantGlowView, phase: String -> view.setPhase(phase) }
      Prop("colors") { view: AssistantGlowView, colors: List<String> -> view.setColors(colors) }
    }
  }

  companion object {
    private const val SUMMON = "onSummon"
  }
}
