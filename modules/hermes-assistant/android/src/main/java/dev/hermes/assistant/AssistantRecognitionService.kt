package dev.hermes.assistant

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.RemoteException
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * The recognition service an assistant must declare. Choosing an assistant also makes its recognition
 * service the phone's voice input, so a stub here would break dictation in every app, Hermes' own
 * composer included. Instead each request is handed on to another installed recogniser (Google's when
 * there is one) or the on-device one, and its callbacks are passed straight back.
 */
class AssistantRecognitionService : RecognitionService() {
  private var inner: SpeechRecognizer? = null

  override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
    release()
    val recognizer = delegate(this)
    if (recognizer == null) {
      Log.w(TAG, "No other speech recogniser is installed")
      safely { listener.error(SpeechRecognizer.ERROR_CLIENT) }
      return
    }
    inner = recognizer
    recognizer.setRecognitionListener(Forward(listener))
    recognizer.startListening(recognizerIntent)
  }

  override fun onStopListening(listener: Callback) {
    inner?.stopListening()
  }

  override fun onCancel(listener: Callback) {
    inner?.cancel()
    release()
  }

  override fun onDestroy() {
    release()
    super.onDestroy()
  }

  private fun release() {
    inner?.destroy()
    inner = null
  }

  private class Forward(private val to: Callback) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = safely { to.readyForSpeech(params ?: Bundle()) }
    override fun onBeginningOfSpeech() = safely { to.beginningOfSpeech() }
    override fun onRmsChanged(rmsdB: Float) = safely { to.rmsChanged(rmsdB) }
    override fun onBufferReceived(buffer: ByteArray?) = safely { if (buffer != null) to.bufferReceived(buffer) }
    override fun onEndOfSpeech() = safely { to.endOfSpeech() }
    override fun onError(error: Int) = safely { to.error(error) }
    override fun onResults(results: Bundle?) = safely { to.results(results ?: Bundle()) }
    override fun onPartialResults(partialResults: Bundle?) = safely { to.partialResults(partialResults ?: Bundle()) }
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    override fun onSegmentResults(segmentResults: Bundle) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) safely { to.segmentResults(segmentResults) }
    }

    override fun onEndOfSegmentedSession() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) safely { to.endOfSegmentedSession() }
    }
  }

  companion object {
    private const val TAG = "HermesRecognition"

    /** tried first, in order: the recognisers phones ship with */
    private val PREFERRED = listOf("com.google.android.googlequicksearchbox", "com.google.android.tts", "com.google.android.as")

    private fun safely(call: () -> Unit) {
      try {
        call()
      } catch (error: RemoteException) {
        Log.w(TAG, "The caller went away mid-recognition", error)
      }
    }

    fun delegateComponent(context: Context): ComponentName? {
      val services = context.packageManager
        .queryIntentServices(Intent(SERVICE_INTERFACE), 0)
        .mapNotNull { it.serviceInfo }
        .filter { it.packageName != context.packageName }
      val pick = PREFERRED.firstNotNullOfOrNull { name -> services.firstOrNull { it.packageName == name } } ?: services.firstOrNull()
      return pick?.let { ComponentName(it.packageName, it.name) }
    }

    private fun delegate(context: Context): SpeechRecognizer? {
      delegateComponent(context)?.let { return SpeechRecognizer.createSpeechRecognizer(context, it) }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
        return SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      }
      return null
    }
  }
}
