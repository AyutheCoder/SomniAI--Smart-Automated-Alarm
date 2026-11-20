package app.somniai.alarm.alarms;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.util.Log;

/**
 * Plays an alarm on the alarm audio stream (USAGE_ALARM), which ringer mode
 * does not silence: silent and vibrate modes only affect ringtones and
 * notifications.
 */
final class AlarmSound {

    static final AudioAttributes ALARM = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();

    private final Context context;
    private final Runnable onError;
    private MediaPlayer player;
    private AudioTrack tone;

    AlarmSound(Context context, Runnable onError) {
        this.context = context;
        this.onError = onError;
    }

    /** Starts this source; false if it can't play here (no such sound, file unreadable before unlock, ...). */
    boolean start(RingController.Source source) {
        stop();
        try {
            if (source == RingController.Source.TONE) {
                tone = makeTone();
                tone.play();
                return true;
            }
            Uri uri = RingtoneManager.getActualDefaultRingtoneUri(context,
                source == RingController.Source.ALARM_SOUND ? RingtoneManager.TYPE_ALARM : RingtoneManager.TYPE_RINGTONE);
            if (uri == null) {
                return false;
            }
            MediaPlayer p = new MediaPlayer();
            player = p;
            p.setAudioAttributes(ALARM);
            p.setDataSource(context, uri);
            p.setLooping(true);
            p.setOnErrorListener((mp, what, extra) -> {
                Log.w(AlarmScheduler.TAG, "alarm sound error " + what + "/" + extra);
                onError.run();
                return true;
            });
            p.prepare();
            p.start();
            return true;
        }
        catch (Exception e) {
            // IOException, SecurityException, IllegalStateException, IllegalArgumentException:
            // any of them means try the next source.
            Log.w(AlarmScheduler.TAG, "can't play " + source + ": " + e);
            stop();
            return false;
        }
    }

    void setVolume(float v) {
        if (player != null) {
            player.setVolume(v, v);
        }
        if (tone != null) {
            tone.setVolume(v);
        }
    }

    void stop() {
        if (player != null) {
            try {
                player.stop();
            }
            catch (IllegalStateException ignored) {
                // Never started; release below is still right.
            }
            player.release();
            player = null;
        }
        if (tone != null) {
            try {
                tone.stop();
            }
            catch (IllegalStateException ignored) {
                // Not playing.
            }
            tone.release();
            tone = null;
        }
    }

    /** Two short beeps and a pause, looped: 880 Hz, 16-bit mono. */
    private static AudioTrack makeTone() {
        int rate = 22050;
        double[][] pattern = { { 880, 0.15 }, { 0, 0.10 }, { 880, 0.15 }, { 0, 0.80 } };
        int frames = 0;
        for (double[] seg : pattern) {
            frames += (int) (seg[1] * rate);
        }
        short[] pcm = new short[frames];
        int i = 0;
        for (double[] seg : pattern) {
            int n = (int) (seg[1] * rate);
            for (int k = 0; k < n; k++, i++) {
                // A 5 ms fade at each edge avoids clicks.
                double edge = Math.min(1, Math.min(k, n - k) / (0.005 * rate));
                pcm[i] = seg[0] == 0 ? 0 : (short) (Math.sin(2 * Math.PI * seg[0] * k / rate) * edge * 0.9 * Short.MAX_VALUE);
            }
        }
        AudioTrack t = new AudioTrack.Builder()
            .setAudioAttributes(ALARM)
            .setAudioFormat(new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(frames * 2)
            .build();
        t.write(pcm, 0, frames);
        t.setLoopPoints(0, frames, -1);
        return t;
    }
}
