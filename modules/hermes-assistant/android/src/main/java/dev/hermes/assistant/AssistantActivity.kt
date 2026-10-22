package dev.hermes.assistant

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.lang.ref.WeakReference

/**
 * The assistant card's window: a translucent activity drawn over whatever app it was summoned on,
 * hosting the `HermesAssistant` root on the app's own React host (one JS runtime, so the card shares
 * the app's signed-in controller). It belongs to no visible task and goes away as soon as it leaves
 * the screen, like the system assistant overlays do.
 *
 * A summon on the lock screen asks for an unlock first: the agent behind the card can run tools, so
 * nothing is heard or sent until the phone is unlocked (`whenUnlocked`).
 */
class AssistantActivity : ReactActivity() {
  private var unlocked = true
  private var unlockAsked = false
  private val waiting = mutableListOf<(Boolean) -> Unit>()

  override fun getMainComponentName(): String = COMPONENT

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /** the same Bold text fix as MainActivity; see plugins/with-android-bold-text.js */
  override fun attachBaseContext(newBase: Context) {
    val config = newBase.resources.configuration
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        config.fontWeightAdjustment != 0 &&
        config.fontWeightAdjustment != Configuration.FONT_WEIGHT_ADJUSTMENT_UNDEFINED) {
      val plain = Configuration(config).apply { fontWeightAdjustment = 0 }
      super.attachBaseContext(newBase.createConfigurationContext(plain))
    } else {
      super.attachBaseContext(newBase)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // React Native restores nothing from a saved state
    super.onCreate(null)
    current = WeakReference(this)
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes = window.attributes.apply {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    // no scrim behind the gesture bar: the card and the glow run to the bottom edge
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
    skipTransition(opening = true)
    showOverLock()
  }

  /**
   * The unlock is asked for once the card is over the lock screen: asked sooner, the card's arrival
   * occludes the keyguard and hides the bouncer it raised, which cancels the request.
   */
  override fun onEnterAnimationComplete() {
    super.onEnterAnimationComplete()
    if (!unlocked && !unlockAsked) askForUnlock()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    onSummon?.invoke()
  }

  /** the card is an overlay: once something else takes the screen it is gone, not kept behind */
  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations && unlocked && !isFinishing) finish()
  }

  override fun finish() {
    super.finish()
    skipTransition(opening = false)
  }

  override fun onDestroy() {
    settleUnlock(false)
    if (current?.get() === this) current = null
    AssistantSession.finishShown()
    super.onDestroy()
  }

  /** `done(true)` once the phone is unlocked (at once when it was), `done(false)` when the unlock was refused */
  fun whenUnlocked(done: (Boolean) -> Unit) {
    if (unlocked) done(true) else waiting.add(done)
  }

  private fun showOverLock() {
    val keyguard = getSystemService(KeyguardManager::class.java) ?: return
    if (!keyguard.isKeyguardLocked) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
      // no unlock request before 8.1: the card stays behind the lock screen, is stopped there and closes
      return
    }
    unlocked = false
    setShowWhenLocked(true)
  }

  private fun askForUnlock() {
    unlockAsked = true
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (keyguard == null || !keyguard.isKeyguardLocked) {
      settleUnlock(true)
      return
    }
    keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
      override fun onDismissSucceeded() = settleUnlock(true)
      override fun onDismissCancelled() = refuse("cancelled")
      override fun onDismissError() = refuse("failed")
    })
  }

  private fun refuse(how: String) {
    Log.i(TAG, "The unlock for the card was $how")
    settleUnlock(false)
    finish()
  }

  private fun settleUnlock(ok: Boolean) {
    unlocked = ok || unlocked
    val pending = waiting.toList()
    waiting.clear()
    for (done in pending) done(ok)
  }

  @Suppress("DEPRECATION")
  private fun skipTransition(opening: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      overrideActivityTransition(if (opening) Activity.OVERRIDE_TRANSITION_OPEN else Activity.OVERRIDE_TRANSITION_CLOSE, 0, 0)
    } else {
      overridePendingTransition(0, 0)
    }
  }

  companion object {
    private const val TAG = "HermesAssistant"

    /** registered in index.ts */
    const val COMPONENT = "HermesAssistant"

    /** the card on screen, if any */
    var current: WeakReference<AssistantActivity>? = null
      private set

    /** set by the module while JS listens: a summon while the card is already up */
    var onSummon: (() -> Unit)? = null

    fun intent(context: Context): Intent =
      Intent(context, AssistantActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
  }
}
