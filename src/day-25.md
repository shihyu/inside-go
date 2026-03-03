# 第二十五天：minit 與 signal 設置

- Day: 25
- 發佈日期: 2019-10-10
- 原文: [https://ithelp.ithome.com.tw/articles/10226695](https://ithelp.ithome.com.tw/articles/10226695)

### 前情提要

------------------------------------------------------------------------

昨日進入到 `mstart` 函式之中，可算是整個 bootstrap 的最後階段。在裡面走到 `mstart1`，也透過 gdb 觀察得知就是在這裡面執行 Hello World 無誤。

#### 開始 `mstart1`

`mstart1` 一樣在 `runtime/proc.go` 裡面，最一開始是這樣：

```go
func mstart1() {
        _g_ := getg()
         
        if _g_ != _g_.m.g0 {
                throw("bad runtime·mstart")
        }

```
先取得當前的 goroutine 之後，如果發現當前的 G 不是 `g0` 就強制中止啟動流程。

> 這麼說來，`throw` 函式以及後續的一連串 panic 處理也頗為值得介紹。雖然 Hello World 本身當然是不會 fail，但是可以想辦法用 gdb 輔助製造出那樣的情境。下次就來追追看吧！

下一段的程式碼開始之前是解說的註解。這裡會紀錄下前一個呼叫（caller）的狀態，包含程式執行指標（`pc`）和堆疊指標（`sp`）以及其他的資訊。這份紀錄會作為最初的堆疊（top stack），給之後的 `mcall` 函式使用，也用來完結那個 thread。接下來在 `mstart1` 呼叫到 `schedule` 之後就再也不會回到這個地方了，所以也可以使用這個紀錄下來的呼叫框架。

```
        save(getcallerpc(), getcallersp())
        asminit()
        minit()

```
這個 `save` 函式之前應該也有看過才對。它先是透過 compiler 的一些幫忙取得這兩個傳入參數，然後在本體之中更新 `sched` 成員變數的諸般內容，讓日後其他執行緒執行 `gogo` 函式的時候使用。

> 還記得嗎？`gogo` 就是相對於 `gosave`、類似 C 的 `longjmp` 那樣的呼叫。它的使用情境通常是 `gogo(&gp.sched)` 呼叫，代表即將加入 `gp` 到排程中。

```go
func save(pc, sp uintptr) {
        _g_ := getg()
      
        _g_.sched.pc = pc
        _g_.sched.sp = sp
        _g_.sched.lr = 0
        _g_.sched.ret = 0
        _g_.sched.g = guintptr(unsafe.Pointer(_g_))
        // We need to ensure ctxt is zero, but can't have a write
        // barrier here. However, it should always already be zero.
        // Assert that.
        if _g_.sched.ctxt != nil {
                badctxt()
        }
}

```
總之就是一些日後會用到的設定。

#### `asminit` 和 `minit`

前者在 `runtime/asm_amd64.s` 當中，但是 amd64 架構不需要執行任何步驟就立刻回傳了，其他像是 arm、386 才有一些考量非得在這裡設定一些 CPU 相關的內容。後者是作業系統相關的部份，根據註解是用來創造一個新的 M。本體在 `runtime/os_linux.go` 之中，

```go
// Called to initialize a new m (including the bootstrap m).
// Called on the new thread, cannot allocate memory.
func minit() {
        minitSignals()
         
        // for debuggers, in case cgo created the thread
        getg().m.procid = uint64(gettid())
}

```
> 註解第二行說不能分配記憶體是什麼意思？裡面的 for debugger 又是什麼意思？難道不是用除錯器就毫無用處嗎？

看看對應的組語，

```go
   0x42664d <runtime.minit+29>:    callq  0x43af40 <runtime.minitSignals>
   0x426652 <runtime.minit+34>:   callq  0x4529d0 <runtime.gettid>
   0x426657 <runtime.minit+39>:   mov    %fs:0xfffffffffffffff8,%rax
   0x426660 <runtime.minit+48>:   mov    0x30(%rax),%rax
   0x426664 <runtime.minit+52>:   mov    (%rsp),%ecx
   0x426667 <runtime.minit+55>:   mov    %rcx,0x48(%rax)
   0x42666b <runtime.minit+59>:   mov    0x8(%rsp),%rbp
   0x426670 <runtime.minit+64>:   add    $0x10,%rsp
   0x426674 <runtime.minit+68>:   retq

```
`minitSignal` 函式在 `runtime/signal_unix.go` 裡面，它會設置一個初始的 m 所需使用的 signal stack 和 mask。我們暫且跳過它只看後面的話，可以印證一些目前為止知道的事情。`mov %fs:0xfffffffffffffff8,%rax` 這個指令就是一直以來取得當前 goroutine 的方式，存放到 `rax` 暫存器之中；之後的兩次存取分別是取得當前的 M（`getg().m`），以及賦值給這個 M 的 `procid` 成員。其中我們也可以看到來自 `gettid` 的回傳值似乎存放在堆疊暫存器（`rsp`）所指的地方，雖然是先放到 4 個位元組的 `ecx` 裡面，再因為轉型而真正使用的是整個 8 byte 的 `rcx`。

這裡的 `gettid` 的確就是系統呼叫無誤。Linux/amd64 的這個系統呼叫 wrapper 在 `runtime/sys_linux_amd64.s`，

```
TEXT runtime·gettid(SB),NOSPLIT,$0-4
        MOVL    $SYS_gettid, AX
        SYSCALL
        MOVL    AX, ret+0(FP)
        RET

```
基本上就是 amd64 的那一套：`rax` 作為系統呼叫號碼（這裡的 `$SYS_gettid` 也定義在檔案稍早處）。

#### `minitSignals` 函式

就如前段描述的那樣，這個函式直截了當，

```go
func minitSignals() {
        minitSignalStack()
        minitSignalMask()
}

```
前者關於佇列，我們可以再深入觀察

```go
func minitSignalStack() {    
        _g_ := getg()        
        var st stackt        
        sigaltstack(nil, &st)
        if st.ss_flags&_SS_DISABLE != 0 {
                signalstack(&_g_.m.gsignal.stack)
                _g_.m.newSigstack = true
        } else {             
                setGsignalStack(&st, &_g_.m.goSigStack)
                _g_.m.newSigstack = false
        }                    
}

```
這裡的 if-else 判斷式分成 GO 語言的通常狀況以及從 cgo 來的狀況。通常狀況的話，直接把 signal 需要的堆疊設置成 `gsignal` 這個 goroutine 的堆疊，這也是我們這個流程當中會經過的分支。

其中有兩個呼叫非常相似，一個是判斷式之前的 `sigaltstack`，代表的是**為了處理 signal 所需要的另一個堆疊**，其本體也是一個系統呼叫的 wrapper。它的功能很有趣，前者是輸入，代表呼叫者可以指定當前 process 的 signal handler 可以使用的堆疊；後者是輸出，代表當前的 signal 所使用的堆疊。另一個是 `signalstack`，其實就是一個設置 signal 堆疊的函式，裡面也會引用只有使用到第一個參數的 `sigaltstack` 系統呼叫。

### 疑問

------------------------------------------------------------------------

- `getg`、`getcaller*` 函式好像都沒有本體，所以應該是 compiler 生成的？相關的程式在哪裡呢？
- `minit` 函式前得住解說不能配置記憶體是什麼意思？
- `getg().m.procid` 賦值自 `gettid`，為什麼說是為了 debugger 的？

### 本日小結

------------------------------------------------------------------------

今日潛入 `minit`，看完了 signal 所需要的堆疊的配置過程。
