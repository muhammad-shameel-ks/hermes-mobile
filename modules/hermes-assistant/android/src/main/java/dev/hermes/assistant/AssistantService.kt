package dev.hermes.assistant

import android.content.Context
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import java.lang.ref.WeakReference

/**
 * Hermes as the phone's digital assistant app. The system binds this service while Hermes holds the
 * assistant role, and opens a session when the reader long-presses power, swipes from a corner or
 * presses the assist key. There is no hotword: an always-on detector needs privileged permissions
 * only preinstalled assistants are granted.
 */
class AssistantService : VoiceInteractionService() {
  /** the card reads nothing off the screen: the system skips collecting the app's text and screenshot for it */
  override fun onReady() {
    super.onReady()
    setDisabledShowContext(VoiceInteractionSession.SHOW_WITH_ASSIST or VoiceInteractionSession.SHOW_WITH_SCREENSHOT)
  }
}

class AssistantSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = AssistantSession(this)
}

/**
 * A session draws nothing itself: it starts the card activity in the assistant layer, above every
 * app and outside multi-window, and ends when the card does.
 */
class AssistantSession(context: Context) : VoiceInteractionSession(context) {
  override fun onPrepareShow(args: Bundle?, showFlags: Int) {
    super.onPrepareShow(args, showFlags)
    setUiEnabled(false)
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    shown = WeakReference(this)
    startAssistantActivity(AssistantActivity.intent(context))
  }

  override fun onDestroy() {
    if (shown?.get() === this) shown = null
    super.onDestroy()
  }

  companion object {
    private var shown: WeakReference<AssistantSession>? = null

    /** the card closed: end the session that opened it, so the next summon starts a fresh one */
    fun finishShown() {
      val session = shown?.get() ?: return
      shown = null
      session.finish()
    }
  }
}
