import Compression
import Foundation

/// Reads ZIP archives (EPUB books): stored and deflated entries, through Apple's Compression framework.
struct ZipArchive {
    struct Entry { let name: String; let method: UInt16; let compressed: Int; let size: Int; let offset: Int }
    let data: Data
    let entries: [String: Entry]

    init?(data: Data) {
        self.data = data
        guard data.count > 22 else { return nil }
        func u16(_ o: Int) -> UInt16 { UInt16(data[data.startIndex + o]) | UInt16(data[data.startIndex + o + 1]) << 8 }
        func u32(_ o: Int) -> UInt32 { UInt32(u16(o)) | UInt32(u16(o + 2)) << 16 }
        // end of central directory: the last 0x06054b50 signature
        var eocd = -1
        var i = data.count - 22
        let stop = max(0, data.count - 22 - 65_557)
        while i >= stop { if u32(i) == 0x0605_4B50 { eocd = i; break }; i -= 1 }
        guard eocd >= 0 else { return nil }
        let count = Int(u16(eocd + 10))
        var p = Int(u32(eocd + 16))
        var out: [String: Entry] = [:]
        for _ in 0..<count {
            guard p + 46 <= data.count, u32(p) == 0x0201_4B50 else { break }
            let method = u16(p + 10)
            let csize = Int(u32(p + 20)), usize = Int(u32(p + 24))
            let nlen = Int(u16(p + 28)), elen = Int(u16(p + 30)), clen = Int(u16(p + 32))
            let local = Int(u32(p + 42))
            let nameData = data.subdata(in: (data.startIndex + p + 46)..<(data.startIndex + p + 46 + nlen))
            let name = String(data: nameData, encoding: .utf8) ?? String(decoding: nameData, as: UTF8.self)
            out[name] = Entry(name: name, method: method, compressed: csize, size: usize, offset: local)
            p += 46 + nlen + elen + clen
        }
        guard !out.isEmpty else { return nil }
        entries = out
    }

    func read(_ name: String) -> Data? {
        guard let e = entries[name] else { return nil }
        let base = data.startIndex
        func u16(_ o: Int) -> Int { Int(data[base + o]) | Int(data[base + o + 1]) << 8 }
        let o = e.offset
        guard o + 30 <= data.count else { return nil }
        let start = o + 30 + u16(o + 26) + u16(o + 28)
        guard start + e.compressed <= data.count else { return nil }
        let raw = data.subdata(in: (base + start)..<(base + start + e.compressed))
        if e.method == 0 { return raw }
        guard e.method == 8, e.size > 0 else { return e.size == 0 ? Data() : nil }
        var out = Data(count: e.size)
        let n = out.withUnsafeMutableBytes { dst in
            raw.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, e.size, src.bindMemory(to: UInt8.self).baseAddress!, raw.count, nil, COMPRESSION_ZLIB)
            }
        }
        return n == e.size ? out : nil
    }

    /// everything into a folder (once)
    func extract(to dir: URL) -> Bool {
        let fm = FileManager.default
        for name in entries.keys where !name.hasSuffix("/") {
            guard !name.contains(".."), let d = read(name) else { continue }
            let url = dir.appendingPathComponent(name)
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? d.write(to: url)
        }
        return true
    }
}
