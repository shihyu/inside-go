# 第十五天：追蹤 newproc

- Day: 15
- 發佈日期: 2019-09-30
- 原文: [https://ithelp.ithome.com.tw/articles/10223003](https://ithelp.ithome.com.tw/articles/10223003)

### 前情提要

------------------------------------------------------------------------

昨日終於結束了 `schedinit` 部份，主要是追 `gcinit` 函式，還有從比較抽象的角度瀏覽了一些垃圾回收的機制。

### 退回一層

回到我們之前所在的 `runtime/asm_amd64.S`：

```go
 ...
        CALL    runtime·schedinit(SB)                                                                                                   
                         
        // create a new goroutine to start program
        MOVQ    $runtime·mainPC(SB), AX         // entry
        PUSHQ   AX       
        PUSHQ   $0                      // arg size
        CALL    runtime·newproc(SB)
        POPQ    AX       
        POPQ    AX
    ...
```

> 官方的[組語文件](https://golang.org/doc/asm)提供非常好的指引！比方說這裡的 `SB` 就是一個虛擬暫存器，代表靜態的 base 位址，用來表達全域的 symbol。

以 Hello World 範例而言，這一段被轉換成真正的 x86_64 組語之後變成這樣：

```
  4512d0:       e8 6b ac fd ff          callq  42bf40 <runtime.schedinit>
  4512d5:       48 8d 05 cc 76 08 00    lea    0x876cc(%rip),%rax        # 4d89a8 <runtime.mainPC>
  4512dc:       50                      push   %rax
  4512dd:       6a 00                   pushq  $0x0
  4512df:       e8 ac 14 fe ff          callq  432790 <runtime.newproc>
  4512e4:       58                      pop    %rax
  4512e5:       58                      pop    %rax

```
看這個產出結果，說 GO 的 IR 組語是 x86 的親兒子真不為過，根本是一對一的超完美對應。那先查查看這個 `mainPC` 本尊何處？

整個 `src` 甚至整個 GO 語言資料夾都看過了，含有 `mainPC` 這個字串的都只有 `src/runtime` 底下的各個架構相依檔案有而已，如

```
../src/runtime/asm_386.s:    PUSHL   $runtime·mainPC(SB) // entry
../src/runtime/asm_386.s:DATA   runtime·mainPC+0(SB)/4,$runtime·main(SB)
../src/runtime/asm_386.s:GLOBL  runtime·mainPC(SB),RODATA,$4
../src/runtime/asm_mipsx.s: MOVW    $runtime·mainPC(SB), R1 // entry
../src/runtime/asm_mipsx.s:DATA runtime·mainPC+0(SB)/4,$runtime·main(SB)
../src/runtime/asm_mipsx.s:GLOBL    runtime·mainPC(SB),RODATA,$4
...

```
它們都是只有三行，第一道取得 `runtime.mainPC`，無論是到記憶體或是到暫存器。再來就是定義，帶有 `DATA` 標籤意味著它是全域變數，且初始化到逗點之後，斜線看起來像是除法的那個語法結構代表著它的資料寬度。通常後面都會直接跟著 `GLOBL` 標籤，同時附上它所屬的區段（這裡剛好也可以完全對應到 ELF 的 `.rodata`），最後一個參數指定資料寬度。

> 我大 RISC-V 沒有原生 PUSH/POP 不就超麻煩？這也只能後續再研究了。

#### `runtime.newproc`

根據註解，編譯器會把所有的 go statement（應該就是那些非同步的 GO-style spawn）轉換成呼叫這個函式。這個函式會創造一個 g（goroutine），並且將傳入的函式加入到那個 g 的等待佇列之中。另外還有特別提到由於 stack 中的參數排列按照順序，因此「不可以切分 stack（cannot split the stack）」，並且附帶 `//go:nosplit` 的編譯器選項，大概類似告訴 C 語言編譯器不要作某些最佳化一樣吧？

函式 `newproc` 一樣在 `runtime/proc.go` 之中，內容如下：

```go
func newproc(siz int32, fn *funcval) {
        argp := add(unsafe.Pointer(&fn), sys.PtrSize)
        gp := getg()
        pc := getcallerpc()
        systemstack(func() {
                newproc1(fn, (*uint8)(argp), siz, gp, pc)
        })
}

```
這個函式吃兩個參數，對照前段的話，應該就是 `siz = 0x0`、`fn = &runtime.mainPC` 這樣的配置吧？用好久沒有拿出來秀的 gdb 觀察看看：

```
$ gdb -d $(pwd) -ex "add-auto-load-safe-path /home/noner/FOSS/2019ITMAN/go/src/runtime/runtime-gdb.py" ./hw
...
(gdb) b runtime.newproc
Breakpoint 1 at 0x432790: file /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go, line 3251.
(gdb) run
Starting program: /home/noner/FOSS/2019ITMAN/go/src/hw 

Breakpoint 1, runtime.newproc (siz=0, fn=<optimized out>) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:3251
3251    func newproc(siz int32, fn *funcval) {
(gdb) bt
#0  runtime.newproc (siz=0, fn=<optimized out>) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:3251
#1  0x00000000004512e4 in runtime.rt0_go () at /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:220
#2  0x0000000000000001 in ?? ()
#3  0x00007fffffffdf08 in ?? ()
#4  0x0000000000000001 in ?? ()
#5  0x00007fffffffdf08 in ?? ()
#6  0x0000000000000000 in ?? ()
(gdb) 

```
使用 `bt` 展示呼叫順序，顯示這次停下的斷點應該與我們正在追蹤的進度一致，只是它竟然說 `fn` 已經被最佳化掉了，這該怎麼辦？沒關係，反正我們知道正解，這個 `fn` 應該要是 `&runtime.mainPC`，事實上應該也可以相信幾個段落前用 objdump 工具獲得的結果：`0x4d89a8`。先射箭再畫靶，我們倒是看看這個值被優化到哪裡去了......

#### 堆疊狀態？

重新啟動一個 gdb 除錯階段，在進入 `newproc` 函式之前就先停下來慢慢考察：

```
Breakpoint 1, runtime.rt0_go () at /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:217
217     MOVQ    $runtime·mainPC(SB), AX     // entry
(gdb) x/4i $pc
=> 0x4512d5 <runtime.rt0_go+293>:  lea    0x876cc(%rip),%rax        # 0x4d89a8 <runtime.mainPC>
   0x4512dc <runtime.rt0_go+300>: push   %rax
   0x4512dd <runtime.rt0_go+301>: pushq  $0x0
   0x4512df <runtime.rt0_go+303>: callq  0x432790 <runtime.newproc>
(gdb) display/x $rsp
1: /x $rsp = 0x7fffffffded0
(gdb) display/i $pc
2: x/i $pc
=> 0x4512d5 <runtime.rt0_go+293>:  lea    0x876cc(%rip),%rax        # 0x4d89a8 <runtime.mainPC>
(gdb) si
218     PUSHQ   AX
1: /x $rsp = 0x7fffffffded0
2: x/i $pc
=> 0x4512dc <runtime.rt0_go+300>:  push   %rax
(gdb) p/x $rax
$1 = 0x4d89a8

```
push 之前，確實是在 `rax` 暫存器中已經存放了 `mainPC` 的位址。

```
(gdb) si
219     PUSHQ   $0          // arg size
1: /x $rsp = 0x7fffffffdec8
2: x/i $pc
=> 0x4512dd <runtime.rt0_go+301>:  pushq  $0x0

```
x86_64 的堆疊處理慣例是 push 時實際數值減少，也就是**往前**擺放，所以這裡可以看到 `rsp` 暫存器減少，且減少之後的那個位址（這裡是 `0x7fffffffdec8`）當中就會存放著 `0x4d89a8` 的值。

```
(gdb) si
220     CALL    runtime·newproc(SB)
1: /x $rsp = 0x7fffffffdec0
2: x/i $pc
=> 0x4512df <runtime.rt0_go+303>:  callq  0x432790 <runtime.newproc>

```
一樣的操作，將數值的 0 推到位址 `0x7fffffffdec0` 之中。

```
(gdb) si
runtime.newproc (siz=0, fn=<optimized out>) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:3251
3251    func newproc(siz int32, fn *funcval) {
1: /x $rsp = 0x7fffffffdeb8
2: x/i $pc
=> 0x432790 <runtime.newproc>: sub    $0x40,%rsp
(gdb)

```
咦？可是呼叫且進入 `newproc` 函式之後，竟然看見 `rsp` 暫存器又推了 8 byte 走？哈哈，筆者這是太久沒看 x86_64 大驚小怪了。由於這個架構沒有特地為回傳位址設計一個 `ra`，所以只好在堆疊上再耗一個空間來存，檢視看看便知是否如此：

```
(gdb) x/4gx $rsp
0x7fffffffdeb8: 0x00000000004512e4  0x0000000000000000
0x7fffffffdec8: 0x00000000004d89a8  0x0000000000000001
(gdb) x/10i 0x00000000004512e4
   0x4512e4 <runtime.rt0_go+308>: pop    %rax
   0x4512e5 <runtime.rt0_go+309>: pop    %rax
   0x4512e6 <runtime.rt0_go+310>: callq  0x42db50 <runtime.mstart>
   ...

```
沒錯！正是如此！事實證明進入 `newproc` 函式的瞬間，`rsp` 中存放著回傳位址。

#### 深入解析 `newproc`

繼續回來看組語吧。

```
0000000000432790 <runtime.newproc>:
  432790:       48 83 ec 40             sub    $0x40,%rsp
  432794:       48 89 6c 24 38          mov    %rbp,0x38(%rsp)
  432799:       48 8d 6c 24 38          lea    0x38(%rsp),%rbp
...
  4327fe:       48 8b 6c 24 38          mov    0x38(%rsp),%rbp
  432803:       48 83 c4 40             add    $0x40,%rsp
  432807:       c3                      retq

```
這只是先幫各位讀者把 prologue 和 epilogue 剝開來。這個函式一開始就將 `rsp` 暫存器挪移了 0x40 的量，相當於是宣告它需要 8 個 64-bit 整數的空間的意思。其中立刻拿來使用的是 `0x38(%rsp)`，這個東西儲存了 `rbp`，也就是 x86 呼叫慣例當中的 frame pointer；儲存了現在的 `rbp` 之後，就立刻將 `0x38(%rsp)` 的位址載入到 `rbp 中`。但可能是因為這是第一次進入到有遵照慣例的函式呼叫？這時候的 `rbp` 其實是 0。

> x86 的呼叫慣例像是 `rbp` 與 `rsp` 的雙人舞。

為了避免混淆，我們可以先列表表示當前的堆疊狀態如下：

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
|7fffffffdea0 |0x28(new rsp)       | ??                 |
|7fffffffde98 |0x20(new rsp)       | ??                 |
|7fffffffde90 |0x18(new rsp)       | ??                 |
|7fffffffde88 |0x10(new rsp)       | ??                 |
|7fffffffde80 |0x08(new rsp)       | ??                 |
|7fffffffde78 |0x00(new rsp)       | ??                 |
+-------------+--------------------+--------------------+

```
接下來的內容，就是 `newproc` 函式如何使用它所配置的這些空間了。回頭看一下程式碼：

```go
        argp := add(unsafe.Pointer(&fn), sys.PtrSize) 
        gp := getg()
        pc := getcallerpc()
        systemstack(func() {
                newproc1(fn, (*uint8)(argp), siz, gp, pc)
        }

```
到底為什麼會用到額外的七個整數的空間呢？這裡可以看到，取得 `argp`、`gp`、以及 `pc` 三個變數，實際上是為了執行無名函式。這個無名函式純粹作為 `systemstack` 的唯一參數（所以這裡應該會佔掉一個 8 byte），並且它本體只直接呼叫了 `newproc1`，而這裡帶有五個參數。還欠一個在哪裡？沒關係我們慢慢看：

```
  43279e:       64 48 8b 04 25 f8 ff    mov    %fs:0xfffffffffffffff8,%rax
  4327a5:       ff ff 
  4327a7:       0f 57 c0                xorps  %xmm0,%xmm0
  4327aa:       0f 11 44 24 08          movups %xmm0,0x8(%rsp)
  4327af:       0f 11 44 24 18          movups %xmm0,0x18(%rsp)
  4327b4:       0f 11 44 24 28          movups %xmm0,0x28(%rsp)
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
`0x43279e` 使用了 `fs` 這個 x86 傳統上稱為 segment register 的暫存器，通常都是被當作 TLB 來使用。GO 語言裡面，這個 -8 的存取位址結果正是當前的 goroutine 的位址，因此其實這裡對應到的是原始程式碼中的 `gp := getg()`；又，這個 `rax` 一直到 `0x4327e1` 才被放入 `0x28(%rsp)`。為什麼是排到第六個的 0x28？它難道不是應該是 `newproc1` 的第四個參數嗎？先繼續看下去吧。

> 中間一段突然冒出非通用暫存器的 `xmm0` 的操作。這是 SSE 擴充的 128 byte 暫存器，這裡應該只是在將需要用到的部份清空為零而已，請讀者自行檢驗。

### 疑問

------------------------------------------------------------------------

- `rbp` 在剛進入 `newproc` 函式時是 0，合理嗎？
- xmm0 的操作是怎麼回事？

### 本日小結

------------------------------------------------------------------------

開始追蹤 `newproc`，算是直接面對 GO 語言赤裸裸的樣貌吧，但是有 C 的基礎的話這些也不算難以理解。雖然斷在這裡很奇怪，但今天感覺也已經很夠了。各位讀者，我們明日再會！
