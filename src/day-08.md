# 第八天：進入 schedinit

- Day: 8
- 發佈日期: 2019-09-23
- 原文: [https://ithelp.ithome.com.tw/articles/10219464](https://ithelp.ithome.com.tw/articles/10219464)

### 前情提要

------------------------------------------------------------------------

昨日從一支 GO 語言程式的源頭往下看，在初始化參數（`runtime.args`）和初始化來自作業系統的資訊（`runtime.osinit`）方面有個簡單的認識。按照順序的話今天要來看排程初始化（`runtime.schedinit`）。

### `runtime.schedinit` 在 `src/runtime/porc.go` 之中

------------------------------------------------------------------------

最一開始就有點打啞謎的味道，請看：

```go
// The bootstrap sequence is:
//
//  call osinit
//  call schedinit
//  make & queue new G
//  call runtime·mstart
//
// The new G calls runtime·main.
func schedinit() {
    // raceinit must be the first call to race detector.
    // In particular, it must be done before mallocinit below calls racemapshadow.
    _g_ := getg()
    if raceenabled {
        _g_.racectx, raceprocctx0 = raceinit()
    }
```

註解部份是我們在組語裡面也看見的順序，昨日已經看完了 `osinit` 的部份。但是這裡就像是小說看到一半突然看見新角色一樣，但是作者又讓他出場得理所當然，也就是這裡的 `G` 或者 `g`。這到底是何許人也？先不停在這裡空轉，看看可以閱讀的部份吧！

進到函式裡面的註解，提到說第一個要呼叫的是 `raceinit`，這個是負責一個叫做 **race 偵測器** 的機制；顧名思義，大概是說 GO 語言的天生特性導致高度的**並行性（concurrency）**，但整個語言的 runtime 還是想要設法維護程式運行的邏輯不脫軌，因此有這個 race condition 的偵測模組。註解並且強調這個一定要在 `mallocinit` 呼叫 `racemapshadow`（抱歉，又是另一個陌生角色）之前做完才行。

> 有沒有發現一件有趣的事？GO 語言的慣例命名法則是**駝峰式**，舉個例子大概是 **`thisIsForExample`** 這樣，但是這裡初始化階段我們看到的是很罕見的一種命名法：不更動大小寫直接串接。若是 Linux 的話也應該至少變成 `sched_init`、`race_init` 之類。

#### `raceinit`

雖然 `raceenabled` 的判定與 `raceinit` 的呼叫在第一行的 `getg` 之後，但既然註解已經先提到了，就先來看看它在哪裡好了。事實上，這些 race 功能相關的內容被定義在 `src/runtime/race0.go` 裡面，而且其實是關閉的！

```go
...
// license that can be found in the LICENSE file.

// +build !race

// Dummy race detection API, used when not built with -race.
```

在沒有附加 `-race` 的建置過程的話，這些功能就都不會被用到了。那我們也就暫且跳過。

#### `G`？

然後第一行程式碼，披頭就來了一個 `_g_ := getg()`！那，深入 `getg()` 的話應該就可以知道 G 是什麼了吧，它定義在 `src/runtime/stubs.go`裡面，可是...

```go
// getg returns the pointer to the current g.
// The compiler rewrites calls to this function into instructions
// that fetch the g directly (from TLS or from the dedicated register).
func getg() *g
```

下面沒有了！趕緊看註解：`getg` 取得**當前的 `g`** 並回傳，可是瑞凡，這不是廢話嗎！**編譯器會將這個呼叫改寫成直接抓取 g 的指令**，比方說從 TLS 或是特定的暫存器裡面。這些人怎麼可以這樣理所當然的 G 來 G 去，卻不告訴我們 G 是什麼呢！？幸好餘光瞄到這個下面的另外一個呼叫 `mcall`，它的註解很長，但是提到更多新角色比方說是 `g0`、`gsignal`，而且還有一個關鍵句：

```go
// mcall switches from the g to the g0 stack and invokes fn(g),
// where g is the goroutine that made the call.
...
```

> TLS 是 **Thread Local Storage**，執行緒專用的儲存空間

也就是說（請注意這是筆者與各位讀者同步學習時的猜測，很可能在日後證明有錯）這裡的 `g` 指的應該就是 goroutine 這種** GO 語言原生的執行緒**的其中一個，`g0` 可能是某個最特定用途的或是 main thread 之類的概念，gsignal 也不難猜想，因為除了序列執行的正常 context 之外本來就會有非同步的 signal context。而這裡的 `fn(g)` 這種作法，也許就是綁定 `g` 執行緒的特殊函式？還是說 `fn` 是指某個函式？不過沒關係這個當作之後的考察目標。

#### 回到 `getg`

我們可以想像 goroutine 可能也是一個結構體，裡面包含成員變數與函數，所以會有 `getg` 這種呼叫。因為他真正的內容已經被編譯器代換，並且在 `getg` 所在的檔案名稱（stubs）可以得知，那只是一個空殼。我們只能去組語檔案挖挖看了。一樣引用 `objdump -d` 工具會發現，其實根本找不到 `getg` 這個函式，畢竟註解說的是替換成**存取 TLS 空間或存取專用的暫存器的指令。**不得已，只好看 `runtime.schedint` 的函式本體：

```
0000000000429620 <runtime.schedinit>:
  429620:   64 48 8b 0c 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rcx
  429627:   ff ff 
  429629:   48 3b 61 10             cmp    0x10(%rcx),%rsp
  42962d:   0f 86 19 02 00 00       jbe    42984c <runtime.schedinit+0x22c>
  429633:   48 83 ec 60             sub    $0x60,%rsp
  429637:   48 89 6c 24 58          mov    %rbp,0x58(%rsp)
  42963c:   48 8d 6c 24 58          lea    0x58(%rsp),%rbp
  429641:   64 48 8b 04 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rax
  429648:   ff ff 
  42964a:   48 89 44 24 38          mov    %rax,0x38(%rsp)
  42964f:   c7 05 37 29 12 00 10    movl   $0x2710,0x122937(%rip)        # 54bf90 <runtime.sched+0x30>
  429656:   27 00 00 
...
  429843:   00 00 
  429845:   e8 26 d3 ff ff          callq  426b70 <runtime.throw>
  42984a:   0f 0b                   ud2    
  42984c:   e8 7f 49 02 00          callq  44e1d0 <runtime.morestack_noctxt>
  429851:   e9 ca fd ff ff          jmpq   429620 <runtime.schedinit>
  429856:   cc                      int3   

```
作為對照，原本這個含是的開頭長成這樣：

```go
 ...
    _g_ := getg()
    if raceenabled {
        _g_.racectx, raceprocctx0 = raceinit()
    }

    sched.maxmcount = 10000

    tracebackinit()
    moduledataverify()
    ...
```

所以這樣看起來，雖然還不太確定 `getg` 函式到底被替換成什麼，但是還是可以找到一個參照點，也就是指定 `sched.maxmcount` 的這個成員變數被指派成 10000，也就是十六進位的 0x2710，所以我們就找到了在 0x42964f 之前，也許都可以說是 `getg` 函式代換的部份。當然，這麼說並不精確，因為 GO 語言的編譯器很有可能做了很多事情。

事實上如果真的用 `objdump -d` 瀏覽看看，會發現很多函式都有共通的起頭，那就是 **GO 語言的 prologue** 形式，大部份都會有像前幾行那樣子的內容。第一行引用的 `fs` 暫存器正是許多專案用來當作 TLS 的慣例之一。這個指令結束之後取得的東西在 `rcx` 暫存器中。隨後，`rcx` 的一個 offset 內容和當前 stack pointer 比較，並包含一個跳轉到後方的 `runtime.morestack_noctxt` 呼叫，之後再直接轉回 `runtime.schedinit`，隱含了一個類似遞迴的行為。這個 `morestack_noctxt` 一樣只有空殼定義在 `stubs.go` 裡面，本體則是在 `src/runtime/asm_amd64.s`；不節錄內容，但是這個呼叫常常會在 prologue，也就是**在函式開頭，卻發現 stack 空間不夠的時候被呼叫**。

#### 更逼近 `getg`

也就是說，筆者本來想追的是 `getg` 函式，這看到的卻是類似 **prologue-epilogue** 對的一般 GO 函式結構而已。於是筆者用了一個比較醜的招式，也就是在 `_g_ := getg()` 前後附上一個 `print` 函式夾起來，結果編譯出來是：

```
  429641:    e8 8a df ff ff          callq  4275d0 <runtime.printlock>
  429646:   48 8d 05 47 ad 08 00    lea    0x8ad47(%rip),%rax        # 4b4394 <go.string.*+0x34>
  42964d:   48 89 04 24             mov    %rax,(%rsp)
  429651:   48 c7 44 24 08 02 00    movq   $0x2,0x8(%rsp)
  429658:   00 00 
  42965a:   e8 91 e8 ff ff          callq  427ef0 <runtime.printstring>
  42965f:   e8 ec df ff ff          callq  427650 <runtime.printunlock>

  429664:   64 48 8b 04 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rax
  42966b:   ff ff 
  42966d:   48 89 44 24 38          mov    %rax,0x38(%rsp)

  429672:   e8 59 df ff ff          callq  4275d0 <runtime.printlock>
  429677:   48 8d 05 16 ad 08 00    lea    0x8ad16(%rip),%rax        # 4b4394 <go.string.*+0x34>

```
中間的兩個空行是筆者安插的以求明顯閱讀。第一個空行以前是比對之後發現的 `print` 函式的真身，由 `printlock` 起頭，`printunlock` 結束，而且會要去某個編譯期決定的記憶體位置撈取所需印出的字串；之後還放治了兩個變數到 stack 裡面，根據格式看來應該是字串起始指標與該字串長度。

也就是說，`getg` 函式，也就是呼叫者企圖取得自己所屬的 goroutine 的這個呼叫，在 `x86_64` 架構裡面是一個暫存器的存取，並將之放置到函式視野的空間裡面。

### 疑問

------------------------------------------------------------------------

- GO 命名的歷史淵源，還有為什麼 runtime 跟大家都不一樣？是否是 linker 之類的工具鏈限制使然？
- goroutine 的構成，顯然是理解 GO 語言的關鍵。 `g0` 和 `gsignal` 分別是怎麼來的？如何生成或指派的？
- fn 函式？
- 怎麼開啟具備 race 功能的編譯模式？

### 本日小結

------------------------------------------------------------------------

觀看 `schedinit` 之路一波三折，但是也看到許多有趣的 GO 語言結構；由於 `runtime` 的真實樣貌有許多透過編譯器解決，因此也有比較多組語的參照。各位讀者，我們明天再會！
