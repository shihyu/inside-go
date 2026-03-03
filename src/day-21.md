# 第二十一天：配置新的 goroutine

- Day: 21
- 發佈日期: 2019-10-06
- 原文: [https://ithelp.ithome.com.tw/articles/10225300](https://ithelp.ithome.com.tw/articles/10225300)

### 前情提要

------------------------------------------------------------------------

昨日我們終於確定取得一個新的 G 物件，並且初次見識到 G 的狀態轉移。

#### 快轉一點點

由於接下來的部份有些雜亂，筆者還是跳過了一些部份，大致交待如下：

```go
         if newg.stack.hi == 0 {
        ...
         
         if readgstatus(newg) != _Gdead {
        ...
         
         totalSize := ...
         if usesLR {
        ...

         if narg > 0 {
        ...

```
第一個條件式剛好就是昨天帶過的內容，新的 G 已經有了 stack 的初始化，因此這裡不可能是未初始化狀態；第二個條件式則是 G 的狀態，已經透過一個比較並交換運算設置成 `_Gdead`；接下來中間有一段與 stack 相關的變數賦值，這裡先跳過；`usesLR` 變數的條件在筆者使用的 x86 平台上不成立；`narg` 是從一開始就一路傳進來至此的參數，在 `rt0_go` 當中也有註解寫明這個第一次的 `newproc` 呼叫使用的參數是 0。

> 坦承以對：其實筆者跳過的內容多半還是尚未理解的 GC 機制中的 write barrier。如果只是將相關程式碼貼出來再說其實自己什麼也看不懂，似乎也不是很負責任的作法，因此這裡就還是先跳過了。

#### 看起來很可疑的 `gostartcallfn`

接下來的一段程式碼是：

```go
        memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
        newg.sched.sp = sp
        newg.stktopsp = sp
        newg.sched.pc = funcPC(goexit) + sys.PCQuantum // +PCQuantum so that previous instruction is in same function
        newg.sched.g = guintptr(unsafe.Pointer(newg))
        gostartcallfn(&newg.sched, fn)                                                                     
        newg.gopc = callerpc
        newg.ancestors = saveAncestors(callergp)
        newg.startpc = fn.fn

```
大部分的內容都是對 `newg` 的成員變數或結構體的賦值，只有中間的 `gostartcallfn` 鶴立雞群，而且它還附帶一個傳入至今無人聞問的 `fn` 參數！這個 `fn` 一樣可以追溯到 `rt0_go` 時傳入的 `runtime.mainPC`。先看它的內容，在 `runtime/stack.go` 之中：

```go
func gostartcallfn(gobuf *gobuf, fv *funcval) { 
        var fn unsafe.Pointer
        if fv != nil {
                fn = unsafe.Pointer(fv.fn)
        } else {
                fn = unsafe.Pointer(funcPC(nilfunc))
        }
        gostartcall(gobuf, fn, unsafe.Pointer(fv))
}

```
這個函式前的註解說，'''這個函式調整 `gobuf` 的內容，像是要執行 `fn` 然後立刻做一個 `gosave` 那樣'''，本身也是迷霧重重。這裡的 `gobuf` 來自 `&newg.sched`，看起來包含了名為 `sp`、`pc` 等等很像是 context 的東西；事實上，如果查詢 `gosave` 函式（位在 `runtime/asm_amd64.s`）的功能，可以發現它是用來轉換執行期環境，可說是 go 語言版本的 `setjmp` （順帶一題，相當於 `longjmp` 的則是同在附近的 `gogo` 函式）。但是這裡說是要調整 `gobuf` 內容嗎？看起來也不像。

首先是檢查傳入的 `funcval` 型別的變數是否為空，若是空就讓它呼叫一個 `nilfunc`

```go
func nilfunc() {
        *(*uint8)(nil) = 0
}

```
看起來也是蠻幽默的一種處理方式，直接對空指標寫值。這裡筆者難免有點好奇，這個機制在 runtime 執行至此的時候已經可以用了嗎？故意把上面的 `if-else` 判斷式拿掉而一律使用後者的結果，之後執行（這裡的測試方法是整組重編，在使用第一組 toolchain 的階段會踩到這個 signal）：

```
$ ./make.bash 
Building Go cmd/dist using /usr/lib/go.
Building Go toolchain1 using /usr/lib/go.
Building Go bootstrap cmd/go (go_bootstrap) using Go toolchain1.
Building Go toolchain2 using go_bootstrap and Go toolchain1.
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x445ce2]

goroutine 1 [running]:
panic(0x79d040, 0xacf980)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/panic.go:722 +0x2c2
runtime.panicmem(...)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/panic.go:199
runtime.sigpanic()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/signal_unix.go:408 +0x3da
runtime.nilfunc()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/stack.go:1073 +0x2
runtime.goexit()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:1375 +0x1
go tool dist: FAILED: /home/noner/FOSS/2019ITMAN/go/pkg/tool/linux_amd64/go_bootstrap install -gcflags=all= -ldflags=all= -i cmd/asm cmd/cgo cmd/compile cmd/link: exit status 2

```
所以其實 signal handler 已經註冊完了？留在疑問裡面等到之後再想辦法去挖掘吧。無論如何，等到這個判斷結束之後，轉一手進入名字很像的 `gostartcall` 函式（位在 `runtime/sys_x86.go`），gdb 追蹤到這裡時的顯示如下：

```
Breakpoint 1, runtime.gostartcallfn (fv=0x4d4648 <runtime.mainPC>, gobuf=<optimized out>)
    at /home/noner/FOSS/2019ITMAN/go/src/runtime/stack.go:1081
...
runtime.gostartcall (fn=0x42a9b0 <runtime.main>, ctxt=0x4d4648 <runtime.mainPC>, buf=<optimized out>)
    at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_x86.go:24
...

```
其內容為：

```go
func gostartcallfn(gobuf *gobuf, fv *funcval) {
        var fn unsafe.Pointer
        if fv != nil {
                fn = unsafe.Pointer(fv.fn)
        } else { 
                fn = unsafe.Pointer(funcPC(nilfunc))
        }        
        gostartcall(gobuf, fn, unsafe.Pointer(fv))
}
...
func gostartcall(buf *gobuf, fn, ctxt unsafe.Pointer) {   
        if buf.lr != 0 {
                throw("invalid use of gostartcall")
        }
        buf.lr = buf.pc
        buf.pc = uintptr(fn)
        buf.ctxt = ctxt
}

```
透過判斷式中的 `fv.fn` 取出的成員變數實際上是 `runtime.main`，這個之後被賦值給 `buf.pc`；先前的 `buf.pc` 內容則是在 `newproc1` 函式決定。看起來的確是只有調整 `buf` 的內容而已。

#### 回到 `newproc1`

```go
        memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
        newg.sched.sp = sp
        newg.stktopsp = sp
        newg.sched.pc = funcPC(goexit) + sys.PCQuantum // +PCQuantum so that previous instruction is in same function
        newg.sched.g = guintptr(unsafe.Pointer(newg))
        gostartcallfn(&newg.sched, fn)                                                                     
        newg.gopc = callerpc
        newg.ancestors = saveAncestors(callergp)
        newg.startpc = fn.fn

```
一開始有個架構相依的清除記憶體內容函式 `memclrNoHeapPointers`，之所以名稱如此是因為又牽扯到 GC 機制的緣故，要使用這個函式的話，必須要我們確定要清空的部份中不含 GC 會想要處理的內容才行。

加上剛才在 `gostartcall*` 的內容，`newg.sched` 有被賦值的成員有 `sp`、`pc`（在這裡的部份後述，在 `gostartcall` 中被設給 `lr`）、`g`、`ctxt`（`runtime.mainPC`）。說到這個 `goexit`，筆者以之為關鍵字，找到了一篇簡體中文[部落格](http://hushi55.github.io/2017/04/09/Golang-Goroutine)清楚的讓人汗顏......。

如果直接用 vim-go 去搜的話，只會找到 stub 裡的空殼提到說這個不應該直接被呼叫，顯然也是初始化時的特殊用法之一。但是可以在 `./runtime/asm_amd64.s` 裡面找到 `TEXT runtime·goexit(SB),NOSPLIT,$0-0` 這個函式：

```
// The top-most function running on a goroutine
// returns to goexit+PCQuantum.
TEXT runtime·goexit(SB),NOSPLIT,$0-0
        BYTE    $0x90   // NOP
        CALL    runtime·goexit1(SB)     // does not return 
        // traceback from goexit1 must hit code range of goexit
        BYTE    $0x90   // NOP

```
> 有趣的是，在 gdb 裡面沒有辦法直接找到 `runtime·goexit` 所在的位址。那麼又要如何取得那個位置呢？筆者先是在閱讀組語時看見 `mov (%rbx),%rsi` 並推測這是 `fn = fv.fn` 運算式；然後發現這個 `rsi` 暫存器會被寫到 `0x40(%rax)` 去，那應該就是 `newg.sched.pc` 所在之處；最後按照位置推算 `newg.sched.lr` 應該就是它前一個的 `0x38(%rax)`，其中的值就是待會會展示的 `0x000000c00004c7d8`。

註解說明，最上游（最一開始）執行在 goroutine 上的函式會回到 `goexit+PCQuantum` 這個位置，而這又是哪裡呢？筆者透過 gdb 去撈 `newg.sched` 的內容，勉強撈到

```
(gdb) x/10gx 0x000000c00004c7d8
0xc00004c7d8:   0x00000000004530d1  0x0000000000000000
...
(gdb) x/10gx 0x4530d0
0x4530d0 <runtime.goexit>:    0xcc90fffde2aae890  0xcccccccccccccccc
0x4530e0 <runtime.gcWriteBarrier>:    0x246c894880c48348  0x894c78246c8d4878
...
(gdb) x/10i 0x4530d0
   0x4530d0 <runtime.goexit>: nop
   0x4530d1 <runtime.goexit+1>:   callq  0x431380 <runtime.goexit1>
   0x4530d6 <runtime.goexit+6>:   nop
...

```
也就是說，離開這些函式之後，應該會直接返回到 `0x4530d1` 的所在之處，呼叫 `goexit1` 離開或是排程。

### 疑問

------------------------------------------------------------------------

- write barrier 的詳細定義、功能，與使用的情境。
- SIGSEGV 是什麼時候註冊好的？
- 為什麼函式名稱裡面會有特殊字元？（如 `runtime·goexit`）是不是這種函式就無法在 gdb 裡面定位？

### 本日小結

------------------------------------------------------------------------

發現了類似 `setjmp`、`longjmp` 呼叫的內容，也看到執行使用者程式的準備一步一步完成了！各位讀者，我們明日再會！
