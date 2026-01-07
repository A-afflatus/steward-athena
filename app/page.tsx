"use client"

import { useState, useEffect, useRef } from "react"
import { Mic, Upload, Video, Type, Menu, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
}

export default function Page() {
  const [isInputMode, setIsInputMode] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isAIGenerating, setIsAIGenerating] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [isVoiceInputting, setIsVoiceInputting] = useState(false)
  const [isButtonPressed, setIsButtonPressed] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const asrSocketRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const latestTextRef = useRef<string>("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const handleIncomingEventRef = useRef<any>(null)
  const audioBufferRef = useRef<Int16Array[]>([])
  const voiceInputTimerRef = useRef<NodeJS.Timeout | null>(null)
  const asrCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const startVoiceInput = async () => {
    if (isAIGenerating) return
    
    try {
      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("您的浏览器不支持语音输入，请使用 Chrome、Edge 或 Firefox。")
        return
      }

      // 1. 开启麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // 2. 建立 ASR WebSocket 连接
      const asrSocket = new WebSocket("ws://localhost:8080/ws/asr")
      asrSocketRef.current = asrSocket
      
      const messageId = Date.now().toString()
      currentMessageIdRef.current = messageId
      latestTextRef.current = ""
      
      asrSocket.onopen = () => {
        console.log("[ASR WS] Connected")
      }
      
      asrSocket.onmessage = (event) => {
        console.log("[ASR WS] Message received:", event.data)
        try {
          const response = JSON.parse(event.data)
          const text = response.transcript || (response.data && response.data.transcript) || ""
          
          if (text) {
            latestTextRef.current = text
            setMessages(prev => 
              prev.map(msg => msg.id === messageId ? { ...msg, content: text } : msg)
            )
          }
        } catch (e) {
          console.error("[ASR WS] Failed to parse message:", e)
          const text = event.data
          latestTextRef.current = text
          setMessages(prev => 
            prev.map(msg => msg.id === messageId ? { ...msg, content: text } : msg)
          )
        }
      }

      asrSocket.onclose = (event) => {
        console.log("[ASR WS] Closed:", event.code, event.reason)
        
        // 清除可能存在的超时计时器
        if (asrCloseTimeoutRef.current) {
          clearTimeout(asrCloseTimeoutRef.current)
          asrCloseTimeoutRef.current = null
        }
        
        const finalContent = latestTextRef.current
        const msgId = currentMessageIdRef.current
        
        // 发送最终识别出的内容给 AI Chat
        if (finalContent.trim()) {
          if (socketRef.current) {
            setIsAIGenerating(true)
            setIsThinking(true)
            socketRef.current.send(JSON.stringify({ content: finalContent }))
          }
        } else {
          // 如果识别内容为空，且消息还存在列表里（空内容），则移除它
          setMessages(prev => prev.filter(msg => msg.id !== msgId))
        }
        
        asrSocketRef.current = null
        currentMessageIdRef.current = null
      }

      asrSocket.onerror = (error) => {
        console.error("[ASR WS] Error:", error)
      }

      // 3. 处理音频
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      
      audioBufferRef.current = []
      let lastSendTime = Date.now()

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF
        }
        
        audioBufferRef.current.push(pcmData)
        
        const now = Date.now()
        if (now - lastSendTime >= 500) {
          if (asrSocket.readyState === WebSocket.OPEN) {
            const totalLength = audioBufferRef.current.reduce((acc, curr) => acc + curr.length, 0)
            const combinedBuffer = new Int16Array(totalLength)
            let offset = 0
            for (const buffer of audioBufferRef.current) {
              combinedBuffer.set(buffer, offset)
              offset += buffer.length
            }
            
            const uint8Array = new Uint8Array(combinedBuffer.buffer)
            let binary = ""
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i])
            }
            const base64Data = btoa(binary)
            
            console.log("[ASR WS] Sending audio chunk, base64 length:", base64Data.length)
            asrSocket.send(JSON.stringify({
              event: "send_audio",
              data: base64Data
            }))
            
            audioBufferRef.current = []
            lastSendTime = now
          }
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      
      setMessages(prev => [
        ...prev,
        {
          id: messageId,
          role: 'user',
          content: ''
        }
      ])
      
      setIsVoiceInputting(true)
    } catch (err: any) {
      console.error("Failed to start voice input:", err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("麦克风权限被拒绝，请在浏览器设置中允许访问麦克风。")
      } else {
        alert("无法开启麦克风: " + err.message)
      }
      cleanupASR()
    }
  }

  const cleanupASR = () => {
    if (voiceInputTimerRef.current) {
      clearTimeout(voiceInputTimerRef.current)
      voiceInputTimerRef.current = null
    }
    if (asrCloseTimeoutRef.current) {
      clearTimeout(asrCloseTimeoutRef.current)
      asrCloseTimeoutRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    if (asrSocketRef.current) {
      if (asrSocketRef.current.readyState === WebSocket.OPEN) {
        asrSocketRef.current.close()
      }
      asrSocketRef.current = null
    }
    setIsVoiceInputting(false)
  }

  const stopVoiceInput = async () => {
    if (!isVoiceInputting) return
    
    // 1. 延迟 0.5 秒停止录音采集，确保最后的语音能够完整录制
    console.log("[ASR WS] Release detected, buffering final 0.5s of audio...")
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 2. 停止录音采集
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    // 3. 发送最后剩余的音频数据块
    if (audioBufferRef.current.length > 0 && asrSocketRef.current?.readyState === WebSocket.OPEN) {
      const totalLength = audioBufferRef.current.reduce((acc, curr) => acc + curr.length, 0)
      const combinedBuffer = new Int16Array(totalLength)
      let offset = 0
      for (const buffer of audioBufferRef.current) {
        combinedBuffer.set(buffer, offset)
        offset += buffer.length
      }
      
      const uint8Array = new Uint8Array(combinedBuffer.buffer)
      let binary = ""
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i])
      }
      const base64Data = btoa(binary)
      
      console.log("[ASR WS] Sending final audio chunk, base64 length:", base64Data.length)
      asrSocketRef.current.send(JSON.stringify({
        event: "send_audio",
        data: base64Data
      }))
      
      audioBufferRef.current = []
    }

    // 4. 根据要求，松手后总共等待 3 秒再发送 stop (close 事件)
    // 已经等待了 0.5 秒，所以还需等待 2.5 秒
    console.log("[ASR WS] Waiting remaining 2.5s before sending stop signal...")
    await new Promise(resolve => setTimeout(resolve, 2500))

    // 5. 发送 close 事件并启动 0.5 秒超时保护
    if (asrSocketRef.current?.readyState === WebSocket.OPEN) {
      console.log("[ASR WS] Sending close event to server")
      asrSocketRef.current.send(JSON.stringify({ event: "close" }))

      // 设置 0.5 秒超时保护，如果服务端没有在 0.5 秒内断开，客户端主动断开
      asrCloseTimeoutRef.current = setTimeout(() => {
        if (asrSocketRef.current && asrSocketRef.current.readyState === WebSocket.OPEN) {
          console.log("[ASR WS] 0.5s timeout reached after stop, closing client socket manually")
          asrSocketRef.current.close()
        }
      }, 500)
    }
    
    setIsVoiceInputting(false)
  }

  const handleVoicePress = () => {
    if (isAIGenerating) return
    setIsButtonPressed(true)
    // 只有按住超过 0.3 秒才执行 startVoiceInput
    voiceInputTimerRef.current = setTimeout(() => {
      startVoiceInput()
    }, 200)
  }

  const handleVoiceRelease = () => {
    setIsButtonPressed(false)
    // 如果还没到 0.3 秒就松开了，清除定时器，不触发语音输入
    if (voiceInputTimerRef.current) {
      clearTimeout(voiceInputTimerRef.current)
      voiceInputTimerRef.current = null
    }
    if (isVoiceInputting) {
      stopVoiceInput()
    }
  }

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    handleIncomingEventRef.current = handleIncomingEvent
  }, [messages, isAIGenerating, isThinking])

  useEffect(() => {
    // 初始化 WebSocket 只有在客户端
    const socket = new WebSocket("ws://localhost:8080/ws/chat")
    socketRef.current = socket

    socket.onopen = () => {
      console.log("WebSocket Connected")
      setIsConnected(true)
    }

    socket.onclose = () => {
      console.log("WebSocket Disconnected")
      setIsConnected(false)
      setIsAIGenerating(false)
      setIsThinking(false)
    }

    socket.onerror = (error) => {
      console.error("WebSocket Error:", error)
      setIsAIGenerating(false)
      setIsThinking(false)
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (handleIncomingEventRef.current) {
          handleIncomingEventRef.current(data)
        }
      } catch (e) {
        console.error("Failed to parse message:", e)
      }
    }

    return () => {
      socket.close()
    }
  }, [])

  const handleIncomingEvent = (event: any) => {
    // 任何来自 AI 的信号都应该结束“思考中”状态
    if (['on_dialogue_start', 'on_chat_model_stream', 'on_dialogue_end', 'on_chat_model_start'].includes(event.event)) {
      setIsThinking(false)
    }

    if (event.event === 'on_dialogue_start') {
      setMessages(prev => {
        // 避免重复创建 AI 消息对象
        const lastMsg = prev[prev.length - 1]
        if (lastMsg && lastMsg.role === 'ai' && lastMsg.content === '') {
          return prev
        }
        return [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'ai',
            content: ''
          }
        ]
      })
      return
    }

    if (event.event === 'on_dialogue_end') {
      setIsAIGenerating(false)
      setIsThinking(false)
      return
    }

    if (event.event === 'on_chat_model_stream' && event.data?.content) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg && lastMsg.role === 'ai') {
          const updatedMsg = { ...lastMsg, content: lastMsg.content + event.data.content }
          return [...prev.slice(0, -1), updatedMsg]
        } else {
          // 如果没有预先创建 AI 消息，则创建一个新的
          return [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'ai',
              content: event.data.content
            }
          ]
        }
      })
    }
  }

  const handleSend = (content?: string) => {
    const messageContent = typeof content === 'string' ? content : inputValue
    if (!messageContent.trim() || !socketRef.current || isAIGenerating) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent
    }

    setMessages(prev => [...prev, userMsg])
    setIsAIGenerating(true)
    setIsThinking(true)
    socketRef.current.send(JSON.stringify({ content: messageContent }))
    
    setInputValue("")
    setIsInputMode(false)
  }

  return (
    <div className="flex h-screen flex-col bg-linear-to-br from-pink-100 via-purple-50 to-cyan-100 transition-colors duration-300 overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 shrink-0 flex items-center justify-between border-b border-pink-200/30 bg-linear-to-r from-pink-50/80 via-purple-50/80 to-cyan-50/80 backdrop-blur-md px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold bg-linear-to-r from-pink-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">Athena</h1>
          <div className={`size-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} title={isConnected ? '已连接' : '未连接'} />
        </div>
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-9 w-9 rounded-full hover:bg-white/50 text-gray-600"
        >
          <Menu className="size-5" />
          <span className="sr-only">菜单</span>
        </Button>
      </header>

      {/* Main Content Area and Footer */}
      <div className="flex-1 relative overflow-hidden">
        <main 
          ref={scrollRef}
          className={`absolute inset-0 flex flex-col px-6 overflow-y-auto pt-4 pb-48 scroll-smooth scrollbar-hide ${messages.length === 0 ? 'items-center justify-center' : 'items-stretch justify-start'}`}
          style={{
            maskImage: 'linear-gradient(to bottom, black 80%, transparent 98%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 98%)'
          }}
          onClick={() => {
            if (isInputMode && !inputValue) {
              setIsInputMode(false)
            }
          }}
        >
            <div className="max-w-4xl mx-auto w-full space-y-6">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] px-4 py-2">
                      <p className="text-gray-500 font-medium text-sm whitespace-pre-wrap text-right">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="w-full max-w-[95%] py-2 animate-in fade-in slide-in-from-left-2 duration-300">
                      <div className="text-[15px] text-gray-800 leading-relaxed font-normal">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            ul: ({ ...props }) => <ul className="list-disc ml-6 space-y-1 my-2" {...props} />,
                            ol: ({ ...props }) => <ol className="list-decimal ml-6 space-y-1 my-2" {...props} />,
                            p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                            code: ({ ...props }) => <code className="bg-gray-200/50 px-1.5 py-0.5 rounded text-pink-600 font-mono text-sm" {...props} />,
                            pre: ({ ...props }) => <pre className="bg-gray-800 text-gray-100 p-4 rounded-lg my-3 overflow-x-auto" {...props} />,
                            h1: ({ ...props }) => <h1 className="text-xl font-bold mb-3 mt-4" {...props} />,
                            h2: ({ ...props }) => <h2 className="text-lg font-bold mb-2 mt-3" {...props} />,
                            h3: ({ ...props }) => <h3 className="text-base font-bold mb-2 mt-2" {...props} />,
                            blockquote: ({ ...props }) => <blockquote className="border-l-4 border-gray-300 pl-4 italic my-2" {...props} />,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isThinking && (
                <div className="flex flex-col items-start">
                  <div className="w-full max-w-[95%] py-2 animate-in fade-in slide-in-from-left-2 duration-300">
                    <div className="text-[15px] text-gray-500 leading-relaxed whitespace-pre-wrap font-normal flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
                      思考中...
                    </div>
                  </div>
                </div>
              )}
            </div>
        </main>

        {/* Bottom Control Buttons */}
        <footer className="absolute bottom-0 left-0 right-0 z-10 p-6 pb-12 pointer-events-none overflow-hidden">
          <div className="max-w-2xl mx-auto w-full pointer-events-auto">
            <div className="relative h-20">
              {/* Input Mode UI */}
              <div 
                className={`absolute inset-0 flex items-center justify-center gap-2 transition-all duration-300 ease-out transform ${
                  isInputMode 
                    ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" 
                    : "opacity-0 translate-y-2 scale-98 pointer-events-none"
                }`}
              >
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSend()
                    }
                  }}
                  disabled={isAIGenerating}
                  placeholder={isAIGenerating ? "AI 思考中..." : "请输入您的问题..."}
                  className="flex-1 h-14 px-6 rounded-full border border-pink-200 bg-white/90 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400/50 backdrop-blur-md transition-all text-gray-700 disabled:bg-gray-100/50 disabled:text-gray-400 disabled:cursor-not-allowed"
                  autoFocus={isInputMode}
                />
                <Button 
                  size="icon" 
                  className="h-14 w-14 rounded-full bg-linear-to-r from-pink-500 to-purple-600 text-white shadow-md hover:shadow-lg hover:opacity-90 transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => handleSend()}
                  disabled={isAIGenerating || !inputValue.trim()}
                >
                  <Send className="size-6" />
                  <span className="sr-only">发送</span>
                </Button>
              </div>

              {/* Default Buttons UI */}
              <div 
                className={`absolute inset-0 flex items-center justify-center gap-4 transition-all duration-300 ease-out transform ${
                  !isInputMode 
                    ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" 
                    : "opacity-0 -translate-y-2 scale-98 pointer-events-none"
                }`}
              >
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="h-20 w-20 rounded-full bg-white/80 hover:bg-white shadow-sm hover:shadow-md transition-all hover:scale-105 active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  onClick={() => setIsInputMode(true)}
                  disabled={isAIGenerating}
                >
                  <Type className="size-6" />
                  <span className="sr-only">文字输入</span>
                </Button>

                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="h-20 w-20 rounded-full bg-white/80 hover:bg-white shadow-sm hover:shadow-md transition-all hover:scale-105 active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  disabled={isAIGenerating}
                >
                  <Upload className="size-6" />
                  <span className="sr-only">上传文件</span>
                </Button>

                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="h-20 w-20 rounded-full bg-white/80 hover:bg-white shadow-sm hover:shadow-md transition-all hover:scale-105 active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  disabled={isAIGenerating}
                >
                  <Video className="size-6" />
                  <span className="sr-only">视频输入</span>
                </Button>

                <Button 
                  size="icon" 
                  variant="secondary" 
                  className={`h-20 w-20 rounded-full transition-all duration-300 ${
                    isButtonPressed 
                      ? "bg-pink-500 text-white scale-110 shadow-lg ring-4 ring-pink-200" 
                      : "bg-white/80 hover:bg-white shadow-sm hover:shadow-md hover:scale-105 active:scale-90"
                  } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
                  disabled={isAIGenerating}
                  onMouseDown={handleVoicePress}
                  onMouseUp={handleVoiceRelease}
                  onMouseLeave={handleVoiceRelease}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleVoicePress();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    handleVoiceRelease();
                  }}
                >
                  <Mic className={`size-6 ${isButtonPressed ? "animate-pulse" : ""}`} />
                  <span className="sr-only">语音输入</span>
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
