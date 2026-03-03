# 第二十八天：其他的 M 登場

- Day: 28
- 發佈日期: 2019-10-13
- 原文: [https://ithelp.ithome.com.tw/articles/10227625](https://ithelp.ithome.com.tw/articles/10227625)

### 前情提要

------------------------------------------------------------------------

昨日終於進入了 `runtime.main`，並將全域的 `mainStarted` 設置為真，昭告天下執行期環境已經快要完備了。

#### 重返 `systemstack`

```go
        if GOARCH != "wasm" { // no threads on wasm yet, so no sysmon
                systemstack(func() {
                        newm(sysmon, nil)
                })
    }

```
顯然我們現在的 CPU 架構並非 `wasm`，所以這裡就會確實進入執行在 `systemstack` 上的 `newm` 函式。它將使用 `sysmon` 函式當作執行的內容，且不指定 P（第二個參數的 nil）。

簡單回顧一下 `systemstack` 這個轉一手的過程。它在架構相依的組語檔案中，依照不同的呼叫者有不同的處理；如果是 `g0` 或 `gsignal` 進來的話，就直接呼叫傳入的函式，這也是我們之前所有呼叫的過程；但如果像現在，已經是一個普通的 goroutine 進入到這裡，就必須要讓 `g0` 來處理。其中還有一行註解寫道，**讓執行過程看起來像是從 `mstart` 直接呼叫 `systemstack`**，也就是說，除了有變換 goroutine 以執行的魔術之外，也有類似之前 `gogo` 那樣的技巧，根本上改變整個執行期佇列的感覺。如 gdb 所示，進到 `newm` 函式之時的 back trace 是這樣子：

```
Breakpoint 1, runtime.newm (fn={void (void)} 0x7fffffffde90, _p_=0x0) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:1840
1840    func newm(fn func(), _p_ *p) {
(gdb) bt
#0  runtime.newm (fn={void (void)} 0x7fffffffde90, _p_=0x0) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:1840
#1  0x0000000000450066 in runtime.main.func1 () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:134
#2  0x00000000004511a6 in runtime.systemstack () at /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:370
#3  0x000000000042d8c0 in ?? () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:1116
#4  0x0000000000451034 in runtime.rt0_go () at /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:220
#5  0x0000000000000000 in ?? ()

```
其中第 3 層雖然 symbol 和所屬檔案、位置全部都是錯的，但位置騙不了人，反組譯之後那個位置恰恰是 `runtime.mstart` 函式的起始位置。

無論如何，進到 `newm` 之後，goroutine 又會切換回 `g0`。

#### `newm` 函式

`newm` 函式使用兩個參數。第一個是 `fn`，將會是新生成的執行緒所要執行的函式，這裡傳入 `sysmon`，以下稱為**系統監視者**；第二個是 P 型別，但是這裡傳入的是 nil（傳入 P 是為了有時候必須被借用做記憶體配置）。

這個函式會生成一個新的 M 供接下來使用，配置的部份在第一行呼叫的 `allocm` 函式之中的

```go
        mp := new(m)
        mp.mstartfn = fn
        mcommoninit(mp)
                  
    mp.g0 = malg(8192 * sys.StackGuardMultiplier)
        mp.g0.m = mp

```
可見除了配置這個結構體本身需要空間之外，還指配了傳進來的函式。`mcommoninit` 函式我們在第十天曾經看到過，總之是一些通用的配置；再來是這個新的 M 必須要有自己的基本 goroutine，使用 `malg` 函式配置之。`newm` 函式接下來進入 `newm1` 函式，這個命名方式大概就類似 `newproc` 呼叫 `newproc1` 的那種感覺吧。

```go
func newm1(mp *m) {
        if iscgo {
        ...
        return
        }       
        execLock.rlock() // Prevent process clone.
        newosproc(mp)
        execLock.runlock()
}

```
我們不在 cgo 呼叫的過程中，所以這裡先略過吧。`execLock` 本身是一個 `rwmutex` 型別的結構體，詳細的演算法無法來得及介紹，但通常它的使用就如註解說的，是為了確保 `clone`、`execute` 之類的函式不至於因為並行處理而造成系統狀態錯誤。夾在兩個 lock 方法之間的 `newosproc` 就是要生成系統監控者執行緒的入口了：

```go
        stk := unsafe.Pointer(mp.g0.stack.hi)
         
        var oset sigset
        sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
        ret := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(funcPC(mstart))) 
        sigprocmask(_SIG_SETMASK, &oset, nil)

```
核心的部份是被兩個 `sigprocmask` 函式夾在中間的 `clone` 函式，這兩個也都是系統呼叫的 wrapper。之所以 `clone` 必須被夾在中間，是不想讓創新執行緒的過程被 signal 中斷徒增紛擾。對於 `clone` 系統呼叫稍有經驗的讀者應該很警覺，這裡的 prototype 加了一點料，的確如此。原本的 Linux clone 長成這樣子：

```
       int clone(int (*fn)(void *), void *child_stack,
                 int flags, void *arg, ...
                 /* pid_t *ptid, void *newtls, pid_t *ctid */ );

```
這個很明顯不同於 `runtime.clone` 針對系統呼叫的 ABI（rdi, rsi, rdx, r10 的順序）給值：

```
TEXT runtime·clone(SB),NOSPLIT,$0
        MOVL    flags+0(FP), DI
        MOVQ    stk+8(FP), SI
        MOVQ    $0, DX
        MOVQ    $0, R10
         
        // Copy mp, gp, fn off parent stack for use by child.
        // Careful: Linux system call clobbers CX and R11.
        MOVQ    mp+16(FP), R8
        MOVQ    gp+24(FP), R9
        MOVQ    fn+32(FP), R12
         
        MOVL    $SYS_clone, AX
        SYSCALL
...

```
這又是怎麼回事呢？其實兩個都有道理，只是 manpage 的內容是給 userspace 參考用的 API，所以 C Library 必須實作成那個樣子。以 GNU libc 為例的話，可以在[這裡](https://github.com/lattera/glibc/blob/master/sysdeps/unix/sysv/linux/x86_64/clone.S)看到註解中寫道兩者的差別。無論如何，剛才提到的**加料**指的就是 M 和 G 的傳入；至於 `stk` 和 `flags` 當然是 Linux 特色的執行緒的基本需求，前者是新執行緒所需要的堆疊空間，後者則是配置新執行緒的組態設定（GO 語言都使用同一組來配置新執行緒）。

在這之後，目前的 goroutine 會正式分出另一個執行緒，

```
        // In parent, return.
        CMPQ    AX, $0
        JEQ     3(PC)
        MOVL    AX, ret+40(FP)
        RET
        
        // In child, on new stack.
        MOVQ    SI, SP
        
        // If g or m are nil, skip Go-related setup.
        CMPQ    R8, $0    // m
        JEQ     nog
        CMPQ    R9, $0    // g
        JEQ     nog
...
        // Call fn
        CALL    R12
       
        // It shouldn't return. If it does, exit that thread.
        MOVL    $111, DI
        MOVL    $SYS_exit, AX
        SYSCALL
        JMP     -3(PC)  // keep exiting

```
原先的執行緒回傳去了，而新生的這個指定它可以使用的堆疊之後，終究最後會呼叫到位在 `r12` 暫存器的函式。但是如果是看得很任真的讀者應該會發覺不對勁，當初 `newm` 想要啟動的是 `sysmon` 函式來監控系統狀態，但是呼叫 `clone` 時已經狸貓換太子變成了 `mstart`！事實上，這是為了配置一些 M 的初始設定，而在 `mstart` 呼叫的 `mstart1` 當中，有一個區塊之前因為條件不合而沒有進入

```go
        if fn := _g_.m.mstartfn; fn != nil {
                fn()
        }

```
這時的新執行緒就會取得當時配置的系統監控者函式，因此會有這樣的 call stack：

```
Thread 2 "hw" hit Breakpoint 1, runtime.sysmon () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:4315
4315    func sysmon() {
(gdb) bt
#0  runtime.sysmon () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:4315
#1  0x000000000042da13 in runtime.mstart1 () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:1238
#2  0x000000000042d92e in runtime.mstart () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:1203
#3  0x0000000000455043 in runtime.clone () at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_linux_amd64.s:587
#4  0x0000000000000000 in ?? ()
(gdb)

```
### 疑問

------------------------------------------------------------------------

- 之前也問過了，可是為什麼函式指標要傳程式碼的指標的指標？
- 到底為什麼會有 `xxx1` 這種函式命名法？
- GO 語言的 rwmutex 機制是什麼？
- 系統監視者函式具體來說是作什麼的？

### 本日小結

------------------------------------------------------------------------

今日正式脫離單線程模式啦！雖然應該是沒時間深入系統監控者 M 了，但是整個 runtime 慢慢完備起來的同時，卻有可能因為 `main.main` 太過短暫而讓那些功能都變成殺雞的牛刀。無論如何，我們就快接近了！各位讀者，我們明日再會！
