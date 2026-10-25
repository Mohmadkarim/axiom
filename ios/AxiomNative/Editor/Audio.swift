import AVFoundation
import Observation
import UIKit

/// Lecture recording in notebooks: AAC audio in Files/rec_<id>.bin (the same files as before), played back with the
/// ink replaying in step (strokes written later in the lecture stay faint until the audio reaches them).
@Observable
final class LectureAudio: NSObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    static let shared = LectureAudio()
    var recordingID: String?
    var recordStart: Date?
    var elapsed: TimeInterval = 0
    var playingID: String?
    var isPlaying = false
    var time: TimeInterval = 0
    var duration: TimeInterval = 0
    var rate: Float = 1
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?

    private func url(_ id: String) -> URL { Store.shared.fileURL("rec_" + id) }

    func record(id: String) async -> String? {
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { return "Microphone access is off. Turn it on in Settings → Axiom." }
        return await MainActor.run {
            do {
                stopPlayback()
                let s = AVAudioSession.sharedInstance()
                try s.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try s.setActive(true)
                let tmp = url(id).deletingPathExtension().appendingPathExtension("m4a")
                try? FileManager.default.removeItem(at: tmp)
                let rec = try AVAudioRecorder(url: tmp, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 32000, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue])
                rec.delegate = self
                guard rec.record() else { return "Recording could not start." }
                recorder = rec; recordingID = id; recordStart = Date(); elapsed = 0
                startTimer()
                UIApplication.shared.isIdleTimerDisabled = true
                return nil
            } catch { return error.localizedDescription }
        }
    }

    /// stops and returns the duration (seconds)
    func stopRecording() -> TimeInterval {
        guard let rec = recorder, let id = recordingID else { return 0 }
        let d = rec.currentTime
        rec.stop()
        recorder = nil; recordingID = nil; recordStart = nil
        let tmp = url(id).deletingPathExtension().appendingPathExtension("m4a")
        try? FileManager.default.removeItem(at: url(id))
        try? FileManager.default.moveItem(at: tmp, to: url(id))
        stopTimer()
        UIApplication.shared.isIdleTimerDisabled = false
        return d
    }

    func play(id: String, at t: TimeInterval? = nil) {
        do {
            if playingID != id || player == nil {
                player?.stop()
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                // the file has no extension the player can use: read it as data
                let data = try Data(contentsOf: url(id))
                let p = try AVAudioPlayer(data: data, fileTypeHint: AVFileType.m4a.rawValue)
                p.delegate = self
                p.enableRate = true
                p.prepareToPlay()
                player = p; playingID = id; duration = p.duration
            }
            if let t { player?.currentTime = max(0, min(t, duration)) }
            player?.rate = rate
            player?.play()
            isPlaying = true
            startTimer()
        } catch { AppState.shared.say("This recording could not be played") }
    }
    func pause() { player?.pause(); isPlaying = false; tick() }
    func toggle(id: String) { if isPlaying && playingID == id { pause() } else { play(id: id) } }
    func seek(_ t: TimeInterval) { player?.currentTime = max(0, min(t, duration)); time = player?.currentTime ?? t }
    func setRate(_ r: Float) { rate = r; player?.rate = r }
    func stopPlayback() { player?.stop(); player = nil; playingID = nil; isPlaying = false; time = 0 }
    func duration(of id: String) -> TimeInterval { (try? AVAudioPlayer(contentsOf: url(id)))?.duration ?? 0 }
    func delete(_ id: String) { if playingID == id { stopPlayback() }; Store.shared.deleteFile("rec_" + id) }

    private func startTimer() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
    }
    private func stopTimer() { if recorder == nil && !isPlaying { timer?.invalidate(); timer = nil } }
    private func tick() {
        if let r = recorder { elapsed = r.currentTime }
        if let p = player { time = p.currentTime }
        if recorder == nil && !isPlaying { stopTimer() }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { isPlaying = false; time = duration; stopTimer() }

    static func clock(_ t: TimeInterval) -> String { let s = Int(t.rounded(.down)); return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60) }
}
