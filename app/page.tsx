import { Mic, Upload, Video, Type, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-100 via-purple-50 to-cyan-100">
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-pink-200/30 bg-gradient-to-r from-pink-50/80 via-purple-50/80 to-cyan-50/80 backdrop-blur-md px-4 py-3">
        <h1 className="text-lg font-semibold bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">Athena</h1>
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-9 w-9 rounded-full hover:bg-white/50 text-gray-600"
        >
          <Menu className="size-5" />
          <span className="sr-only">菜单</span>
        </Button>
      </header>
      {/* Main Content Area */}
      <main className="flex flex-1 flex-col items-center justify-center px-6">


      </main>

      {/* Bottom Control Buttons */}
      <footer className="p-6 pb-12">
        {/* Status Indicator */}
        <div className="flex flex-col items-center gap-3 pb-3">
          {/* Loading Dots */}
          <div className="flex gap-2">
            <div className="h-4 w-4 rounded-full bg-gray-400"></div>
            <div className="h-4 w-4 rounded-full bg-gray-400"></div>
            <div className="h-4 w-4 rounded-full bg-gray-400"></div>
          </div>
          {/* Status Text */}
          <p className="text-center text-base text-muted-foreground">你可以开始说话</p>
        </div>
        <div className="flex items-center justify-center gap-4">
          {/* Text Input Button */}
          <Button size="icon" variant="secondary" className="h-20 w-20 rounded-full bg-white/80 hover:bg-white">
            <Type className="size-6" />
            <span className="sr-only">文字输入</span>
          </Button>

          {/* Upload Button */}
          <Button size="icon" variant="secondary" className="h-20 w-20 rounded-full bg-white/80 hover:bg-white">
            <Upload className="size-6" />
            <span className="sr-only">上传文件</span>
          </Button>

          {/* Video Button */}
          <Button size="icon" variant="secondary" className="h-20 w-20 rounded-full bg-white/80 hover:bg-white">
            <Video className="size-6" />
            <span className="sr-only">视频输入</span>
          </Button>

          {/* Microphone Button */}
          <Button size="icon" variant="secondary" className="h-20 w-20 rounded-full bg-white/80 hover:bg-white">
            <Mic className="size-6" />
            <span className="sr-only">语音输入</span>
          </Button>
        </div>
      </footer>
    </div>
  )
}
