import Foundation
import AVFoundation

enum WavEncoder {
    /// Encode mono Float32 samples as 16-bit PCM WAV.
    static func monoFloat32ToWav(_ samples: [Float], sampleRate: Int) -> Data {
        let numSamples = samples.count
        let bytesPerSample = 2
        let dataSize = numSamples * bytesPerSample
        var data = Data(count: 44 + dataSize)

        func writeASCII(_ offset: Int, _ s: String) {
            for (i, u) in s.utf8.enumerated() {
                data[offset + i] = u
            }
        }
        func writeU32(_ offset: Int, _ v: UInt32) {
            var le = v.littleEndian
            withUnsafeBytes(of: &le) { data.replaceSubrange(offset..<offset + 4, with: $0) }
        }
        func writeU16(_ offset: Int, _ v: UInt16) {
            var le = v.littleEndian
            withUnsafeBytes(of: &le) { data.replaceSubrange(offset..<offset + 2, with: $0) }
        }

        writeASCII(0, "RIFF")
        writeU32(4, UInt32(36 + dataSize))
        writeASCII(8, "WAVE")
        writeASCII(12, "fmt ")
        writeU32(16, 16)
        writeU16(20, 1) // PCM
        writeU16(22, 1) // mono
        writeU32(24, UInt32(sampleRate))
        writeU32(28, UInt32(sampleRate * bytesPerSample))
        writeU16(32, UInt16(bytesPerSample))
        writeU16(34, 16)
        writeASCII(36, "data")
        writeU32(40, UInt32(dataSize))

        var o = 44
        for s in samples {
            let clipped = max(-1 as Float, min(1 as Float, s))
            let i16: Int16 =
                clipped < 0
                ? Int16(clipped * Float(Int16.min))
                : Int16(clipped * Float(Int16.max))
            var le = i16.littleEndian
            withUnsafeBytes(of: &le) { data.replaceSubrange(o..<o + 2, with: $0) }
            o += 2
        }
        return data
    }

    /// Downsample / convert an AVAudioPCMBuffer channel to Float32 mono list.
    static func floats(from buffer: AVAudioPCMBuffer) -> [Float] {
        let n = Int(buffer.frameLength)
        guard n > 0 else { return [] }
        if let ch = buffer.floatChannelData?[0] {
            return Array(UnsafeBufferPointer(start: ch, count: n))
        }
        if let ch = buffer.int16ChannelData?[0] {
            var out = [Float](repeating: 0, count: n)
            for i in 0..<n {
                out[i] = Float(ch[i]) / Float(Int16.max)
            }
            return out
        }
        return []
    }

    /// Linear resample to 16 kHz mono (Whisper server expects this).
    static func resampleTo16k(_ input: [Float], sampleRate: Double) -> [Float] {
        let target: Double = 16_000
        if abs(sampleRate - target) < 1 { return input }
        guard !input.isEmpty, sampleRate > 0 else { return input }
        let ratio = sampleRate / target
        let outLen = max(1, Int((Double(input.count) / ratio).rounded()))
        var out = [Float](repeating: 0, count: outLen)
        for i in 0..<outLen {
            let src = Double(i) * ratio
            let i0 = Int(src)
            let i1 = min(i0 + 1, input.count - 1)
            let t = Float(src - Double(i0))
            out[i] = input[i0] * (1 - t) + input[i1] * t
        }
        return out
    }
}
