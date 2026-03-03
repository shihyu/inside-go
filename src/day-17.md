# 第十七天：看看 systemstack 函式呼叫

- Day: 17
- 發佈日期: 2019-10-02
- 原文: [https://ithelp.ithome.com.tw/articles/10223877](https://ithelp.ithome.com.tw/articles/10223877)

### 前情提要

------------------------------------------------------------------------

昨日我們以相當貼近記憶體的方式看完了 `newproc` 函式，主要是在兜出後續呼叫所需要的參數，為接下來的 `systemstack` 呼叫作準備。

#### 進入 `systemstack`

`newproc` 函式呼叫 `systemstack`：

```
        systemstack(func() {
                newproc1(fn, (*uint8)(argp), siz, gp, pc)
        })

```
而 `systemstack` 又是呼叫到哪裡呢？結果這次撲了個空。在 `runtime/stubs.go` 裡面只有一個型別的宣告，

```go
//go:noescape                                                                                             
func systemstack(fn func())

```
大部分的解釋都在上方的註解中。大意是，`systemstack` 會執行 `fn` 函式（而且還記得嗎？從參數列表看來，實際上傳入的是某個存放該無名函式指標的變數的指標）。然後有些不同的判斷，根據所呼叫的 goroutine 而定，會有不同的應對方式：

1.  `g0` （註解中稱之為 per-OS-thread）
2.  \`gsignal
3.  normal g  
    若是前兩者的話，就直接執行 `fn` 函式並回傳。若否，則必須切換到系統堆疊執行該函式。另外註解中也提到，無名函式的使用方式是常用作法，因為其中的變數其實仍然可以享有整個函式的視野，就像 `newproc` 的 `gp` 等變數可以直接在無名函式內部使用一樣；若是無名函式內部有一些回傳值或是賦予值的變數，也可以在後續拿出來使用。

然而，在之前擷取的組語片段中，明明是有看到 `systemstack` 的本體的。這又是怎麼回事呢？

#### `systemstack` 本體

一樣使用 `objdump` 工具來觀察，整個 runtime 函式庫裡面用到這個呼叫的地方還真不少啊。直接搜尋那個位址，得到：

```
00000000004513f0 <runtime.systemstack>:
  4513f0:       48 8b 7c 24 08          mov    0x8(%rsp),%rdi
  4513f5:       64 48 8b 04 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rax
  4513fc:       ff ff 
  4513fe:       48 8b 58 30             mov    0x30(%rax),%rbx
  451402:       48 3b 43 50             cmp    0x50(%rbx),%rax
  451406:       74 78                   je     451480 <runtime.systemstack+0x90>
  451408:       48 8b 13                mov    (%rbx),%rdx
  45140b:       48 39 d0                cmp    %rdx,%rax
  45140e:       74 70                   je     451480 <runtime.systemstack+0x90>
  451410:       48 3b 83 c0 00 00 00    cmp    0xc0(%rbx),%rax
  451417:       75 6f                   jne    451488 <runtime.systemstack+0x98>

```
如果要符合註解的邏輯的話，我們這裡看到的兩組 `je` 指令，應該就是分別判斷當前的 `g`（應該是在 `0x4513f5` 那一行取得，放到 `rax` ）是否等於 `g0` 與 `gsignal` 吧？所以這樣才能一起跳到 `0x451480` 的捷徑處理。`0x451410` 的 `cmp` 指令則是反面判斷，概念上應該是類似 `\_g\_.m.g == g` 之類的判斷式，如果不相等的話就進到錯誤處理：

```
  45147f:       c3                      retq   
  451480:       48 89 fa                mov    %rdi,%rdx
  451483:       48 8b 3f                mov    (%rdi),%rdi
  451486:       ff e7                   jmpq   *%rdi
  451488:       48 8d 05 81 05 ff ff    lea    -0xfa7f(%rip),%rax        # 441a10 <runtime.badsystemstack>
  45148f:       ff d0                   callq  *%rax
  451491:       cd 03                   int    $0x3

```
如上面這一段稍微後面一點的片段，`0x451480` 這裡終於用到進入 `systemstack` 時取用的 `rdi` 暫存器。先對它取一次值，這樣會取到 `fn` 函式指標，之後才以 `jmpq` 指令跳躍過去。還記得昨日的有一個疑問提到說，為什麼傳入無名函式的時候不能直接傳函數指標，而必須傳儲存該指標的變數的指標嗎？這裡的存取方式如果已經寫成這樣，那麼傳入端當然也就必須配合了；還是這是倒果為因，其實是因為 GO 語言的呼叫慣例，使得這裡一定要這樣子寫呢？

筆者推敲推敲總覺得越來越奇怪。雖然說透過 vim-go 導航工具只有找到 `runtime/stubs.go`，但這個函式的感覺實在不像是可以光靠編譯器生成的東西，所以再次 grep 一下發現，果然是被定義在架構相依的組語檔案中啊！`systemstack` 真身在 `runtime/asm\_amd64.s` 之中，與上段列出的組語部份差不多。值得一提的是，在進入為一般 goroutine 的情況下，上兩段之間省略的部份相當於是 goroutine 的 context switch 操作，有興趣的讀者可以深入追蹤。

#### 軌跡

筆者嘗試用 gdb 直接在 `systemstack` 下斷點，發現其實早在這之前的 `schedinit` 就已經呼叫過多次，其中也不乏許多有 `heap` 關鍵字的呼叫。經過比較逼近的斷點設置方法之後，終於來到這裡。接下來就是要檢驗我們的 Hello World 流程在這裡是怎麼走的。沒有意外的話當然應該是要走 `g0` 的捷徑路線，然後進入呼叫 `newproc1` 的無名函式。

```
(gdb) x/2i $pc
=> 0x451483 <runtime.systemstack+147>: mov    (%rdi),%rdi
   0x451486 <runtime.systemstack+150>:    jmpq   *%rdi
(gdb) si
388     JMP DI
(gdb) p/x $rdi
$1 = 0x450b10
(gdb) x/10i $rdi
   0x450b10 <runtime.newproc.func1>:  mov    %fs:0xfffffffffffffff8,%rcx
   ...
(gdb) si
runtime.newproc.func1 () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:3255
3255        systemstack(func() {

```
果不其然是這個流程，那麼就讓我們繼續走下去吧！昨日也曾經貼上 `runtime.newproc.func1` 的組語內容，裡面其實也大多是參數的重新定位與安排，接下來就會進入到 `newproc1` 函式，我們又回到了 `runtime/proc.go` 之中。

```go
func newproc1(fn *funcval, argp *uint8, narg int32, callergp *g, callerpc uintptr) { 
        _g_ := getg()
 
        if fn == nil {
                _g_.m.throwing = -1 // do not dump full stacks
                throw("go of nil func value")
        }
        acquirem() // disable preemption because it can be holding p in a local var
        siz := narg
        siz = (siz + 7) &^ 7
    ...

```
一開始先針對傳入的 `fn` 作判斷，不應該沒有東西；關於 `acquirem` 函式，雖然語意上可以猜測它的用意，但是與註解之間的連結實在完全沒有頭緒，先跳過。再來是關於 `siz` 變數的給值，這裡稍微秀了一手 bit 操作魔術。GO 語言的 `&^` 運算子是清除 bit 的意思，`&^7` 也就是 C 語言裡 `%8` 的意思；先加 7 再執行這個動作的話就會有一個階梯狀的輸出效果：`siz=0` 時為 0、`siz=1~8` 時為 8、`siz=9~16` 時為 16。也就是說這裡要計算出來的值並不是參數的個數，而是參數所佔的大小，在 x86_64 上當然就是 8 byte 為單位了。

### 疑問

------------------------------------------------------------------------

- `acquirem` 的註解為何是與 `p` 是否被存取有關？心理需要更好的 model 來理解這些 GO 語言的抽象物件了...
- `acquirem` 和 `releasem` 的語意應該要有 atomic 的感覺，為何這裡不需要呢？GO 語言有什麼確保不會發生 race condition 的假設？

### 本日小結

------------------------------------------------------------------------

往更廣泛、更具操控性的 API `newproc1` 邁進了！然而實在是覺得關於 P-M-G 關係還是不甚了解，有些地方很難理出道理來。也許明天先找一下相關的教學再說？
