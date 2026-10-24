import AVFoundation
import Foundation

/// Lecture recording for notebooks: records to Files/rec_<id>.bin (AAC in an .m4a container) and plays it back,
/// reporting the playhead to the page so ink can replay in sync with the audio.
final class AudioBridge: NSObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var recordingId: String?
    private let filesDir: () -> URL
    var onTick: ((String) -> Void)?

    init(filesDir: @escaping () -> URL) {
        self.filesDir = filesDir
    }

    private func url(_ id: String) -> URL {
        let safe = String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" })
        return filesDir().appendingPathComponent("rec_" + safe + ".bin")
    }

    func start(id: String, completion: @escaping (Bool, String?) -> Void) {
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { completion(false, "Microphone access is off. Turn it on in Settings → Axiom."); return }
                do {
                    self.stopPlayback()
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
                    try session.setActive(true)
                    let settings: [String: Any] = [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: 32000,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
                    ]
                    // record with a real extension so the container is MPEG-4; it is renamed to the store's name on stop
                    let tmp = self.url(id).deletingPathExtension().appendingPathExtension("m4a")
                    try? FileManager.default.removeItem(at: tmp)
                    let rec = try AVAudioRecorder(url: tmp, settings: settings)
                    rec.delegate = self
                    guard rec.record() else { completion(false, "Recording could not start."); return }
                    self.recorder = rec
                    self.recordingId = id
                    self.startTimer()
                    completion(true, nil)
                } catch {
                    completion(false, error.localizedDescription)
                }
            }
        }
    }

    func stop() -> Double {
        guard let rec = recorder else { return 0 }
        let d = rec.currentTime
        rec.stop()
        recorder = nil
        if let id = recordingId {
            let dest = url(id)
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.moveItem(at: rec.url, to: dest)
            recordingId = nil
        }
        stopTimerIfIdle()
        return d
    }

    func play(id: String, at: Double) -> String? {
        do {
            if player == nil || player?.url != url(id) {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio)
                try session.setActive(true)
                player = try AVAudioPlayer(contentsOf: url(id), fileTypeHint: AVFileType.m4a.rawValue)
                player?.delegate = self
                player?.enableRate = true
                player?.prepareToPlay()
            }
            guard let p = player else { return "No recording" }
            p.currentTime = max(0, min(at, p.duration))
            p.play()
            startTimer()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func pause() { player?.pause(); tick(); stopTimerIfIdle() }
    func seek(_ t: Double) { if let p = player { p.currentTime = max(0, min(t, p.duration)); tick() } }
    func setRate(_ r: Float) { player?.rate = r }
    func duration(id: String) -> Double { (try? AVAudioPlayer(contentsOf: url(id), fileTypeHint: AVFileType.m4a.rawValue))?.duration ?? 0 }
    func delete(id: String) { try? FileManager.default.removeItem(at: url(id)) }

    private func stopPlayback() { player?.stop(); player = nil }

    private func startTimer() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
    }
    private func stopTimerIfIdle() {
        if recorder == nil && !(player?.isPlaying ?? false) { timer?.invalidate(); timer = nil }
    }
    private func tick() {
        if let r = recorder {
            r.updateMeters()
            onTick?("{\"rec\":true,\"t\":\(r.currentTime)}")
        } else if let p = player {
            onTick?("{\"rec\":false,\"t\":\(p.currentTime),\"playing\":\(p.isPlaying),\"d\":\(p.duration)}")
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        tick()
        stopTimerIfIdle()
    }
}
