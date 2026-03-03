# 第十六天：newproc1 之前的堆疊準備動作

- Day: 16
- 發佈日期: 2019-10-01
- 原文: [https://ithelp.ithome.com.tw/articles/10223431](https://ithelp.ithome.com.tw/articles/10223431)

### 前情提要

------------------------------------------------------------------------

昨日開始了 `newproc` 函式，概念上應該是要準備一個新的 goroutine 準備執行？通常是用在 go statement 的生成，但是這裡是第一次，理論上是要準備用來生成 `main` 函式的執行

#### 現在堆疊狀態

```
+-------------+--------------------+--------------------+
|    位址     |      實際意義      |      實際內容      |
+-------------+--------------------+--------------------+
|7fffffffdec8 |第二個參數  fn      | 0x4d89a8           |
|7fffffffdec0 |第一個參數  siz     | 0                  |
|7fffffffdeb8 |`newproc` 回傳位址  | 0x4512e4           |
+-------------+--------------------+--------------------+
|7fffffffdeb0 |old rbp             | 0                  |`newproc` 函式的 frame
|7fffffffdea8 |0x30(new rsp)       | ??                 |
|7fffffffdea0 |0x28(new rsp) gp    | 0x55db00           |
|7fffffffde98 |0x20(new rsp)       | ??                 |
|7fffffffde90 |0x18(new rsp)       | ??                 |
|7fffffffde88 |0x10(new rsp)       | ??                 |
|7fffffffde80 |0x08(new rsp)       | ??                 |
|7fffffffde78 |0x00(new rsp)       | ??                 |
+-------------+--------------------+--------------------+

```
#### 剩下的部份

```
  4327b9:       48 8d 0d 50 e3 01 00    lea    0x1e350(%rip),%rcx        # 450b10 <runtime.newproc.func1>
  4327c0:       48 89 4c 24 08          mov    %rcx,0x8(%rsp)
  4327c5:       48 8d 4c 24 50          lea    0x50(%rsp),%rcx
  4327ca:       48 89 4c 24 10          mov    %rcx,0x10(%rsp)
  4327cf:       48 8d 4c 24 58          lea    0x58(%rsp),%rcx
  4327d4:       48 89 4c 24 18          mov    %rcx,0x18(%rsp)
  4327d9:       8b 4c 24 48             mov    0x48(%rsp),%ecx
  4327dd:       89 4c 24 20             mov    %ecx,0x20(%rsp)
  4327e1:       48 89 44 24 28          mov    %rax,0x28(%rsp)
  4327e6:       48 8b 44 24 40          mov    0x40(%rsp),%rax
  4327eb:       48 89 44 24 30          mov    %rax,0x30(%rsp)
  4327f0:       48 8d 44 24 08          lea    0x8(%rsp),%rax
  4327f5:       48 89 04 24             mov    %rax,(%rsp)
  4327f9:       e8 f2 eb 01 00          callq  4513f0 <runtime.systemstack>

```
`0x4327b9` 這裡取址 `&runtime.newproc.func1`，在原本程式碼中完全不見蹤影，哪裡有什麼 `func1`？其實就是那個作為 `systemstack` 唯一的參數的無名函式，可以在反組譯當中繼續搜尋其蹤跡：

```
0000000000450b10 <runtime.newproc.func1>:
  450b10:       64 48 8b 0c 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rcx
  450b17:       ff ff 
  450b19:       48 3b 61 10             cmp    0x10(%rcx),%rsp
  450b1d:       76 4a                   jbe    450b69 <runtime.newproc.func1+0x59>
  450b1f:       48 83 ec 30             sub    $0x30,%rsp
  450b23:       48 89 6c 24 28          mov    %rbp,0x28(%rsp)
  450b28:       48 8d 6c 24 28          lea    0x28(%rsp),%rbp
  450b2d:       48 8b 42 10             mov    0x10(%rdx),%rax
  450b31:       8b 4a 18                mov    0x18(%rdx),%ecx
  450b34:       48 8b 5a 20             mov    0x20(%rdx),%rbx
  450b38:       48 8b 72 28             mov    0x28(%rdx),%rsi
  450b3c:       48 8b 52 08             mov    0x8(%rdx),%rdx
  450b40:       48 8b 12                mov    (%rdx),%rdx
  450b43:       48 89 14 24             mov    %rdx,(%rsp)
  450b47:       48 89 44 24 08          mov    %rax,0x8(%rsp)
  450b4c:       89 4c 24 10             mov    %ecx,0x10(%rsp)
  450b50:       48 89 5c 24 18          mov    %rbx,0x18(%rsp)
  450b55:       48 89 74 24 20          mov    %rsi,0x20(%rsp)
  450b5a:       e8 b1 1c fe ff          callq  432810 <runtime.newproc1>
  450b5f:       48 8b 6c 24 28          mov    0x28(%rsp),%rbp
  450b64:       48 83 c4 30             add    $0x30,%rsp
  450b68:       c3                      retq   
  450b69:       e8 32 09 00 00          callq  4514a0 <runtime.morestack>
  450b6e:       eb a0                   jmp    450b10 <runtime.newproc.func1>

```
本來預期裡面只會有一個 `runtime.newroc1` 的函式呼叫，意外發現無名函式似乎和一般函式的呼叫慣例不太一樣？這裡一樣有取得 `%fs:-8` 的 goroutine 動作，但不同的是會去和 `rsp` 的值比較；要是較小的話，就跳到 `0x450b96` 的地方呼叫 `morestack` 函式。這不是很有道理嗎？要是呼叫到一個函式開頭發現似乎空間不夠我使用，那麼當然要設法取得更多堆疊。取得之後，一個豪邁的跳躍指令直接跳回自己，但是這不會有無條件遞迴而無法中止的問題，因為並沒有加深堆疊。

無論如何，這個無名函式的進入點位址就這樣被存入 `0x8(rsp)` 中了。接下來是

```
  4327c5:       48 8d 4c 24 50          lea    0x50(%rsp),%rcx
  4327ca:       48 89 4c 24 10          mov    %rcx,0x10(%rsp)

```
昨日很清楚有提到這個函式只配置了八個 8 byte 整數空間並且相對應地挪移了 `rsp`，但為什麼這裡竟然可以將 `0x50(rsp)` 的位址當作參數來傳遞呢？且讓我們重新回顧堆疊圖表：

```go
+-------------+--------------------+--------------------+
|    位址     |      實際意義      |      實際內容      |
+-------------+--------------------+--------------------+
|7fffffffdec8 |第二個參數  fn      | 0x4d89a8           | ====> 數了 0x50 的話剛好是這個東西！也就是 &runtime.mainPC。
|7fffffffdec0 |第一個參數  siz     | 0                  |
|7fffffffdeb8 |`newproc` 回傳位址  | 0x4512e4           |
+-------------+--------------------+--------------------+
|7fffffffdeb0 |old rbp             | 0                  |`newproc` 函式的 frame
|7fffffffdea8 |0x30(new rsp)       | ??                 |
|7fffffffdea0 |0x28(new rsp) gp    | 0x55db00           | //註：這個時候尚未寫入
|7fffffffde98 |0x20(new rsp)       | ??                 |
|7fffffffde90 |0x18(new rsp)       | ??                 |
|7fffffffde88 |0x10(new rsp)       | ??                 |
|7fffffffde80 |0x08(new rsp) func1 | 0x450b10           |
|7fffffffde78 |0x00(new rsp)       | ??                 |
+-------------+--------------------+--------------------+

```
該位置對應到先前準備好的 `fn`，也就是說其實我們隱隱約約開始發現了，無名函式的本體內容應該在這裡也會有對應關係

```
     newproc1(fn, (*uint8)(argp), siz, gp, pc)
        // fn => 0x10(rsp)
        //
        //
        // gp => 0x28(rsp)
        //

```
可以預期剩下的三個參數應該也可以這樣被配置進去。緊接著的兩組也是越過當前函式框架的存取：

```
  4327cf:       48 8d 4c 24 58          lea    0x58(%rsp),%rcx
  4327d4:       48 89 4c 24 18          mov    %rcx,0x18(%rsp)
  4327d9:       8b 4c 24 48             mov    0x48(%rsp),%ecx
  4327dd:       89 4c 24 20             mov    %ecx,0x20(%rsp)

```
咦？方才的 `0x50` 已經是我們有紀錄以來的最遠之處，這裡竟然要放 `0x58`？這其實也呼應了昨日介紹 `newproc` 註解時提到的，我們希望執行 `fn` 函式之前的這些處理「Cannot split the stack」，因為 `fn` 之後其實就會放置他所需要的參數，也正是這裡看見的名為 `argp` 的變數：這是一個參數列表的起始位址。再來 `0x48` 對應到傳入前的 siz，當然也沒有問題；另一個證據是，這裡不是用 `rcx` 而是用 4 byte 版本的 `ecx`，顯然就是。

再來是

```
  4327e1:       48 89 44 24 28          mov    %rax,0x28(%rsp)
  4327e6:       48 8b 44 24 40          mov    0x40(%rsp),%rax
  4327eb:       48 89 44 24 30          mov    %rax,0x30(%rsp)

```
`0x4327e1` 沒來由的突然使用 `rax` 的內容，其實就是稍早已經取得了的 `gp`。再來是 `0x40` 的存取，這相當於是 `newproc` 的回傳位址。稍微更新一下堆疊狀態如下：

```
+-------------+--------------------+--------------------+
|    位址     |      實際意義      |      實際內容      |
+-------------+--------------------+--------------------+
|7fffffffdec8 |第二個參數  fn      | 0x4d89a8           |
|7fffffffdec0 |第一個參數  siz     | 0                  |
|7fffffffdeb8 |`newproc` 回傳位址  | 0x4512e4           |
+-------------+--------------------+--------------------+
|7fffffffdeb0 |old rbp             | 0                  |`newproc` 函式的 frame
|7fffffffdea8 |0x30(new rsp) pc    | 0x4512e4           |
|7fffffffdea0 |0x28(new rsp) gp    | 0x55db00           |
|7fffffffde98 |0x20(new rsp) siz   | 0                  |
|7fffffffde90 |0x18(new rsp) argp  | 0x7fffffffded0     |
|7fffffffde88 |0x10(new rsp) fn    | 0x7fffffffdec8     |
|7fffffffde80 |0x08(new rsp) func1 | 0x450b10           |
|7fffffffde78 |0x00(new rsp)       | ??                 |
+-------------+--------------------+--------------------+

```
最後呼叫 `systemstack` 前的片段是

```
  4327f0:       48 8d 44 24 08          lea    0x8(%rsp),%rax
  4327f5:       48 89 04 24             mov    %rax,(%rsp)
  4327f9:       e8 f2 eb 01 00          callq  4513f0 <runtime.systemstack>

```
結果是儲存無名函式 `func1` 的位址！無論如何，接下來就可以往 `systemstack` 邁進了。

### 疑問

------------------------------------------------------------------------

- 為什麼不能直接傳入 `func1` 就好呢？這樣不是還能省一個記憶體的存取嗎？
- 為什麼要傳 `newproc` 的回傳位址給將由無名函式呼叫的 `newproc1` 呢？

### 本日小結

------------------------------------------------------------------------

在 `newproc` 花了很多心思處理這個傳入參數的順序，並一方面使用 gdb 確認推算無誤，可是好像其實沒有追蹤到什麼機制，反而是 x86_64 的組語重新看了一次。不管怎樣，各位讀者，我們明日再會！
