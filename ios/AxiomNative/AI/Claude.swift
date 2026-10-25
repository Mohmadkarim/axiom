import Foundation

/// The Claude Messages API over HTTPS (there is no official Swift SDK): streaming text, server tools (web search),
/// pause_turn continuation, structured JSON output.
enum Claude {
    static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    static var apiKey: String { (Library.shared.settings.str("aiKey") ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    static var model: String { Library.shared.settings.str("aiModel") ?? "claude-opus-5-5" }
    static var hasKey: Bool { apiKey.hasPrefix("sk-ant-") }

    struct APIError: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? {
            switch status {
            case 401: return "The API key was not accepted. Check it in Settings."
            case 403: return "This API key is not allowed to use this model."
            case 413: return "That was too much to send at once. Try with fewer pages or pictures."
            case 429: return "Too many requests right now. Wait a moment and try again."
            case 500...599: return "Claude is having trouble right now. Try again in a moment."
            case 0: return "No connection. Check the internet and try again."
            default: return message
            }
        }
    }

    struct Result { var text: String; var content: [JSON]; var stopReason: String }

    /// One streamed request; `onText` receives the answer as it grows, `onStatus` tool activity ("Searching the web…").
    static func stream(system: [JSON], messages: [JSON], maxTokens: Int = 32000, effort: String = "medium", tools: [JSON]? = nil,
                       format: JSON? = nil, model: String? = nil,
                       onText: @escaping (String) -> Void = { _ in }, onStatus: @escaping (String?) -> Void = { _ in }) async throws -> Result {
        var msgs = messages
        var total = Result(text: "", content: [], stopReason: "")
        // server tools can pause a long turn: continue it (up to 4 times)
        for _ in 0..<4 {
            let r = try await once(system: system, messages: msgs, maxTokens: maxTokens, effort: effort, tools: tools, format: format, model: model ?? Self.model,
                                   prefix: total.text, onText: onText, onStatus: onStatus)
            total.text += r.text
            total.content += r.content
            total.stopReason = r.stopReason
            guard r.stopReason == "pause_turn" else { break }
            msgs.append(["role": "assistant", "content": r.content])
        }
        return total
    }

    private static func once(system: [JSON], messages: [JSON], maxTokens: Int, effort: String, tools: [JSON]?, format: JSON?, model: String,
                             prefix: String, onText: @escaping (String) -> Void, onStatus: @escaping (String?) -> Void) async throws -> Result {
        var body: JSON = ["model": model, "max_tokens": maxTokens, "stream": true, "system": system, "messages": messages]
        var output: JSON = ["effort": effort]
        if let format { output["format"] = format }
        body["output_config"] = output
        if let tools, !tools.isEmpty { body["tools"] = tools }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.timeoutInterval = 600
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.httpBody = JSONIO.data(body)

        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do { (bytes, response) = try await URLSession.shared.bytes(for: req) } catch { throw APIError(status: 0, message: error.localizedDescription) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status != 200 {
            var data = Data()
            for try await b in bytes { data.append(b) }
            let msg = JSONIO.object(data)?.obj("error")?.str("message") ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw APIError(status: status, message: msg)
        }
        var blocks: [Int: JSON] = [:]
        var partial: [Int: String] = [:]
        var text = ""
        var stop = ""
        for try await line in bytes.lines {
            guard line.hasPrefix("data: "), let d = String(line.dropFirst(6)).data(using: .utf8), let ev = JSONIO.object(d) else { continue }
            switch ev.str("type") {
            case "content_block_start":
                guard let i = ev.int("index"), let b = ev.obj("content_block") else { break }
                blocks[i] = b
                if b.str("type") == "server_tool_use" { onStatus(b.str("name") == "web_search" ? "Searching the web…" : "Working…") }
            case "content_block_delta":
                guard let i = ev.int("index"), let delta = ev.obj("delta") else { break }
                switch delta.str("type") {
                case "text_delta":
                    let t = delta.str("text") ?? ""
                    text += t
                    let prev = blocks[i]?.str("text") ?? ""
                    blocks[i]?["text"] = prev + t
                    onStatus(nil)
                    onText(prefix + text)
                case "thinking_delta":
                    let prev = blocks[i]?.str("thinking") ?? ""
                    blocks[i]?["thinking"] = prev + (delta.str("thinking") ?? "")
                case "signature_delta": blocks[i]?["signature"] = delta.str("signature") ?? ""
                case "input_json_delta": partial[i, default: ""] += delta.str("partial_json") ?? ""
                default: break
                }
            case "content_block_stop":
                if let i = ev.int("index"), let pj = partial[i], let data = pj.data(using: .utf8), let input = JSONIO.parse(data) { blocks[i]?["input"] = input }
            case "message_delta":
                if let s = ev.obj("delta")?.str("stop_reason") { stop = s }
            case "error":
                throw APIError(status: 500, message: ev.obj("error")?.str("message") ?? "Stream error")
            default: break
            }
        }
        let content = blocks.keys.sorted().compactMap { blocks[$0] }
        return Result(text: text, content: content, stopReason: stop)
    }

    /// a JSON object answer (structured output)
    static func json(system: [JSON], messages: [JSON], schema: JSON, maxTokens: Int = 32000, effort: String = "medium", onText: @escaping (String) -> Void = { _ in }) async throws -> JSON {
        let r = try await stream(system: system, messages: messages, maxTokens: maxTokens, effort: effort, format: ["type": "json_schema", "schema": schema], onText: onText)
        guard let d = r.text.data(using: .utf8), let j = JSONIO.object(d) else { throw APIError(status: -1, message: "The answer could not be read. Try again.") }
        return j
    }

    // MARK: content blocks

    static func text(_ s: String) -> JSON { ["type": "text", "text": s] }
    static func image(jpeg: Data) -> JSON { ["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": jpeg.base64EncodedString()] as JSON] }
    static func pdf(_ data: Data, title: String) -> JSON { ["type": "document", "source": ["type": "base64", "media_type": "application/pdf", "data": data.base64EncodedString()] as JSON, "title": title] }
}
