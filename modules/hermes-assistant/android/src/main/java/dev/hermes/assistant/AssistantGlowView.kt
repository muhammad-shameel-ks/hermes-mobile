package dev.hermes.assistant

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RuntimeShader
import android.graphics.SweepGradient
import android.os.Build
import android.view.Choreographer
import android.view.RoundedCorner
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.exp
import kotlin.math.min

/**
 * The light around the screen's edge while the card is up. It runs on the render thread from a
 * Choreographer callback, so a reply streaming through the JS thread never stutters it. On Android 13+
 * it is an AGSL shader: a glow that follows the display's rounded corners, swells in waves travelling
 * round the edge and brightens with the voice; earlier versions stroke the edge with a turning sweep
 * gradient. Only the edge bands are drawn, never the middle of the screen.
 */
class AssistantGlowView(context: Context, appContext: AppContext) : ExpoView(context, appContext), Choreographer.FrameCallback {
  private enum class Phase(val intensity: Float, val speed: Float) {
    IDLE(0.4f, 0.35f),
    LISTENING(1f, 1f),
    THINKING(0.85f, 1.9f),
    RESPONDING(0.6f, 0.6f),
  }

  private val dp = resources.displayMetrics.density
  private val renderer: Renderer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ShaderRenderer() else StrokeRenderer()

  private var colors = intArrayOf(0xFF7C8CFF.toInt(), 0xFFB36BFF.toInt(), 0xFFFF7BAC.toInt(), 0xFF5ED6FF.toInt())
  private var phase = Phase.LISTENING
  private var targetLevel = 0f
  private var level = 0f
  /** eases in from nothing, so the light rises rather than appears */
  private var intensity = 0f
  /** advances at the phase's speed, so a phase change never jumps the waves */
  private var clock = 0f
  private var lastFrame = 0L
  private var ticking = false
  private var corner = 0f

  init {
    setWillNotDraw(false)
  }

  fun setLevel(value: Float) {
    targetLevel = value.coerceIn(0f, 1f)
    if (animates()) return
    level = targetLevel
    invalidate()
  }

  fun setPhase(name: String) {
    phase = Phase.entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: Phase.IDLE
    if (animates()) return
    intensity = phase.intensity
    invalidate()
  }

  fun setColors(values: List<String>) {
    val parsed = values.mapNotNull { runCatching { Color.parseColor(it) }.getOrNull() }
    if (parsed.isEmpty()) return
    colors = IntArray(PALETTE) { parsed[it % parsed.size] }
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    corner = displayCorner()
    if (!animates()) intensity = phase.intensity
    tick()
  }

  override fun onDetachedFromWindow() {
    halt()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility == VISIBLE) tick() else halt()
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!ticking) return
    val dt = if (lastFrame == 0L) 0f else min((frameTimeNanos - lastFrame) / 1e9f, MAX_STEP_S)
    lastFrame = frameTimeNanos
    level += (targetLevel - level) * (1f - exp(-dt * LEVEL_EASE))
    intensity += (phase.intensity - intensity) * (1f - exp(-dt * PHASE_EASE))
    clock += dt * phase.speed
    invalidate()
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width == 0 || height == 0 || intensity <= 0.001f) return
    renderer.draw(canvas, width.toFloat(), height.toFloat())
  }

  private fun tick() {
    if (ticking || !isAttachedToWindow || windowVisibility != VISIBLE || !animates()) {
      invalidate()
      return
    }
    ticking = true
    lastFrame = 0L
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun halt() {
    ticking = false
    Choreographer.getInstance().removeFrameCallback(this)
  }

  /** off when the reader turned animations off: the light then stands still */
  private fun animates() = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()

  private fun displayCorner(): Float {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 0f
    return rootWindowInsets?.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius?.toFloat() ?: 0f
  }

  /** how far in from the edge the glow reaches at its widest */
  private fun bandPx() = BAND_DP * dp

  private interface Renderer {
    fun draw(canvas: Canvas, w: Float, h: Float)
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private inner class ShaderRenderer : Renderer {
    private val shader = RuntimeShader(GLOW_SHADER)
    private val paint = Paint()

    override fun draw(canvas: Canvas, w: Float, h: Float) {
      val band = bandPx()
      shader.setFloatUniform("size", w, h)
      shader.setFloatUniform("time", clock)
      shader.setFloatUniform("level", level)
      shader.setFloatUniform("intensity", intensity)
      shader.setFloatUniform("radius", corner)
      shader.setFloatUniform("band", band)
      shader.setFloatUniform("dp", dp)
      shader.setColorUniform("c0", colors[0])
      shader.setColorUniform("c1", colors[1])
      shader.setColorUniform("c2", colors[2])
      shader.setColorUniform("c3", colors[3])
      paint.shader = shader
      // the gaussian is spent by 2.6x its widest reach; a rounded corner pulls the glow inward by 0.3r
      val s = min(band * GLOW_REACH * 2.6f + corner * 0.3f, min(w, h) / 2f)
      canvas.drawRect(0f, 0f, w, s, paint)
      canvas.drawRect(0f, h - s, w, h, paint)
      canvas.drawRect(0f, s, s, h - s, paint)
      canvas.drawRect(w - s, s, w, h - s, paint)
    }
  }

  private inner class StrokeRenderer : Renderer {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val matrix = Matrix()
    private val rect = RectF()
    private var gradientFor: IntArray? = null
    private var gradientSize = 0f to 0f
    private var gradient: SweepGradient? = null

    override fun draw(canvas: Canvas, w: Float, h: Float) {
      val sweep = sweepFor(w, h)
      matrix.setRotate(clock * 40f, w / 2f, h / 2f)
      sweep.setLocalMatrix(matrix)
      paint.shader = sweep
      val band = bandPx() * (0.7f + 0.9f * level)
      // widest and faintest first, a bright hairline last: a soft glow without a blur pass
      for ((width, alpha) in listOf(band * 1.6f to 0.1f, band * 0.9f to 0.18f, band * 0.45f to 0.32f, 2f * dp to 0.9f)) {
        paint.strokeWidth = width
        paint.alpha = (alpha * intensity * 255f).toInt().coerceIn(0, 255)
        rect.set(width / 2f, width / 2f, w - width / 2f, h - width / 2f)
        val r = (corner - width / 2f).coerceAtLeast(0f)
        canvas.drawRoundRect(rect, r, r, paint)
      }
    }

    private fun sweepFor(w: Float, h: Float): SweepGradient {
      val cached = gradient
      if (cached != null && gradientFor === colors && gradientSize == (w to h)) return cached
      val loop = IntArray(colors.size + 1) { colors[it % colors.size] }
      return SweepGradient(w / 2f, h / 2f, loop, null).also {
        gradient = it
        gradientFor = colors
        gradientSize = w to h
      }
    }
  }

  companion object {
    private const val PALETTE = 4
    private const val BAND_DP = 18f
    /** the reach's ceiling over the band, at full voice */
    private const val GLOW_REACH = 1.6f
    private const val LEVEL_EASE = 14f
    private const val PHASE_EASE = 4f
    private const val MAX_STEP_S = 0.05f

    private val GLOW_SHADER = """
      uniform float2 size;
      uniform float time;
      uniform float level;
      uniform float intensity;
      uniform float radius;
      uniform float band;
      uniform float dp;
      layout(color) uniform half4 c0;
      layout(color) uniform half4 c1;
      layout(color) uniform half4 c2;
      layout(color) uniform half4 c3;

      const float TAU = 6.2831853;

      float roundedBox(float2 p, float2 box, float r) {
        float2 q = abs(p) - box + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      half3 palette(float t) {
        float x = fract(t) * 4.0;
        half3 a = x < 1.0 ? c0.rgb : (x < 2.0 ? c1.rgb : (x < 3.0 ? c2.rgb : c3.rgb));
        half3 b = x < 1.0 ? c1.rgb : (x < 2.0 ? c2.rgb : (x < 3.0 ? c3.rgb : c0.rgb));
        return mix(a, b, half(smoothstep(0.0, 1.0, fract(x))));
      }

      half4 main(float2 xy) {
        float2 box = size * 0.5;
        float2 p = xy - box;
        // distance in from the display's rounded edge; outside it (under the bezel) counts as on it
        float inside = max(-roundedBox(p, box, radius), 0.0);
        // where on the edge, 0..1 around the screen, with the aspect folded out so the waves spread evenly
        float around = atan(p.y * box.x / box.y, p.x) / TAU + 0.5;
        float swell = 0.5 + 0.5 * sin(around * TAU * 2.0 + time * 1.3) * sin(around * TAU * 3.0 - time * 0.9);
        float reach = band * (0.45 + 0.55 * swell) * (0.7 + 0.9 * level);
        float g = inside / max(reach, 1.0);
        float glow = exp(-g * g);
        float rim = exp(-inside / ((1.2 + 2.0 * level) * dp));
        float alpha = clamp((0.7 * glow + 0.55 * rim) * intensity, 0.0, 1.0);
        half3 color = palette(around + time * 0.07);
        // the rim burns whiter as the voice gets louder
        color = mix(color, half3(1.0), half(rim * 0.35 * level));
        return half4(color * half(alpha), half(alpha));
      }
    """.trimIndent()
  }
}
