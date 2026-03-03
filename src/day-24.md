# 第二十四天：上膛的 goroutine

- Day: 24
- 發佈日期: 2019-10-09
- 原文: [https://ithelp.ithome.com.tw/articles/10226471](https://ithelp.ithome.com.tw/articles/10226471)

### 前情提要

------------------------------------------------------------------------

走到 `newproc1` 函式的結尾。新的 goroutine 已經如子彈一般上膛了。

#### 一路返回

`newproc1` 回傳之後會一路回到最初的 `rt0_go` 去，這裡簡單回顧一下：

```go
func newproc(siz int32, fn *funcval) { 
        argp := add(unsafe.Pointer(&fn), sys.PtrSize)
        gp := getg()
        pc := getcallerpc()
        systemstack(func() {
                newproc1(fn, argp, siz, gp, pc)
        })
}

```
它先是回到當初在系統堆疊的空間上運行的那個無名函式（用 gdb 觀察的話會發現它的正式名稱是 `runtime.newproc.func1`），然後回到 `newproc` 函式的最後一行，然後

```
     // create a new goroutine to start program
        MOVQ    $runtime·mainPC(SB), AX     // entry
        PUSHQ   AX
        PUSHQ   $0          // arg size
        CALL    runtime·newproc(SB)
        POPQ    AX
        POPQ    AX
    
        // start this M
        CALL    runtime·mstart(SB)

```
回到 `rt0_go`。筆者這裡的環境是在 `runtime/asm_amd64.s` 之中。可以看見前半段的註解寫著這一段是要**創造新的 goroutine 並開始程式**。其中，`runtime.mainPC` 作為一個進入點，與代表不附帶參數的 0 一起當作參數傳入我們已經走了一個多禮拜的 `newproc` 函式。到此為止我們可以再回顧一下曾經在 `schedinit` 函式開頭看見的註解：

```
// The bootstrap sequence is:
//            
//      call osinit
//      call schedinit
//      make & queue new G
//      call runtime·mstart
//            
// The new G calls runtime·main.

```
原來我們已經經過了第三個階段，要邁向第四階段啦！

#### 啟動這個 M

```go
// mstart is the entry-point for new Ms.
//
// This must not split the stack because we may not even have stack
// bounds set up yet.  
//                   
// May run during STW (because it doesn't have a P yet), so write
// barriers are not allowed.           
//                     
//go:nosplit         
//go:nowritebarrierrec
func mstart() {

```
註解提到這個函式是新的 M 的進入點。

> 附帶了之前也常常看見的 `go:nosplit` 代表編譯器在編譯這裡的時候不可以分割 stack，但筆者實在還沒參透這個部份，也只好附在疑問一節之中。話又說回來，不能分割的原因是這時可能還沒有設定好邊界，但問題是我們之前不是處理了一些堆疊相關的內容嗎？還是那些只是給 `newg` 的，和這裡沒有關係？

```go
func mstart() {                                              
        _g_ := getg()                                        
                                                             
        osStack := _g_.stack.lo == 0                         
        if osStack {

```
這裡一開始一樣是取得當前 goroutine，然後依據它的 stack 下界是否為零作為是否正在使用系統堆疊的判斷依據。這裡事實上不會進入，因此就先略過了。

> 使用 gdb 觀察可以理所當然的證明這時候的 goroutine 一樣是 g0 沒有變動，那麼難道 g0 不算是在使用系統堆疊嗎？

```
        // Initialize stack guard so that we can start calling regular
        // Go code. 
        _g_.stackguard0 = _g_.stack.lo + _StackGuard
        // This is the g0, so we can also call go:systemstack
        // functions, which check stackguard1.
        _g_.stackguard1 = _g_.stackguard0

```
在 `type g struct` 的註解中描述 `stackguard0` 和 `stackguard1` 都是在 stack growth prologue 當中比較的對象，只是後者是給 C 使用的，前者是 GO 使用的。以上是堆疊相關的設置，之後又會深入一層。

#### `mstart1` 到 `mexit`

```go
        mstart1()                                 
        // Exit this thread.
        switch GOOS {  
        case "windows", "solaris", "illumos", "plan9", "darwin", "aix":
                // Windows, Solaris, illumos, Darwin, AIX and Plan 9 always system-allocate
                // the stack, but put it in _g_.stack before mstart,
                // so the logic above hasn't set osStack yet.
                osStack = true
        }      
        mexit(osStack)

```
中間的 switch-case 結構顯然沒有 Linux 的事，這裡先不管；`mstart1` 函式理論上會在最後一哩路作一些 M 的設置，然後就接使用者寫的 `main` （事實上編譯之後的正式名稱為 `main.main`）之後的部份。`mexit` 函式則反之，準備清理所使用的資源，事實上，使用 gdb 檢查 `mexit` 在這個 hello world 程式的呼叫狀況的話會發現，根本還來不及使用到就已經離開了：

```
(gdb) b runtime.mexit
Breakpoint 1 at 0x42c6a0: file /usr/lib/go/src/runtime/proc.go, line 1243.
(gdb) run
Starting program: /home/noner/FOSS/2019ITMAN/go/src/hw 
[New LWP 6868]
[New LWP 6869]
[New LWP 6870]
[New LWP 6871]
Hello World!
[LWP 6871 exited]
[LWP 6870 exited]
[LWP 6869 exited]
[LWP 6868 exited]
[Inferior 1 (process 6864) exited normally]
(gdb)

```
而且過程中還生成了四個 thread！

### 疑問

------------------------------------------------------------------------

- `go:nosplit` 具體來說是在哪些條件下必須要下？
- 什麼才算是系統堆疊？
- stack growth prologue 具體來說是指什麼？
- 看到很多註解的部份提到必須要有 P 才能下 write barrier，他們的關聯是什麼？

### 本日小結

------------------------------------------------------------------------

今日回到 `rt0_go` 再往 `mstart1` 出發，同時實在好奇為何 `mstart1` 之後會新生成這麼多個執行緒呢？
