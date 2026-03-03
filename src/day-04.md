# 第四天：拆解 Println

- Day: 4
- 發佈日期: 2019-09-19
- 原文: [https://ithelp.ithome.com.tw/articles/10217682](https://ithelp.ithome.com.tw/articles/10217682)

### 前情提要

------------------------------------------------------------------------

昨日多深入一些，理解 `os.Stdout` 的生成與牽涉到的結構。

### 回到 `fmt.Fprintln`

------------------------------------------------------------------------

如果讀者跟筆者一樣是從 C 語言過來的，一定也跟筆者一樣覺得單是追蹤 `os.Stdout` 就已經看到很多 GO 語言神秘之處，明明只是結構體初始化，就已經埋下許多非同步事件的伏筆之類的。不過我們還是先完成整個 Hello World 程式的追蹤吧。

```go
// These routines end in 'ln', do not take a format string,
// always add spaces between operands, and add a newline
// after the last operand.
            
// Fprintln formats using the default formats for its operands and writes to w.
// Spaces are always added between operands and a newline is appended.
// It returns the number of bytes written and any write error encountered.
func Fprintln(w io.Writer, a ...interface{}) (n int, err error) {
        p := newPrinter()
        p.doPrintln(a)
        n, err = w.Write(p.buf)
        p.free()
        return
}
```

註解中說，`ln` 結尾的這些函式**不會**接收格式字串，也就不會有什麼你出現 `%d` 我就要幫你替換成一個整數的這種功能；換句話說，這比較接近 C 語言裡面的 `puts()` 函式，而且最後會換行。

註解又說 `Fprintln` 會將傳入的參數依**預設格式**印出至 `io.Writer` 型態的 `w` 參數去。預設格式是說，也許今天傳入的不定長度參數中有諸般混雜的型別變數存在，則其實你不需要指定它們所需要的格式字串（`%d`、`%f` 之類），GO 語言自然保證它們會依照自身型別的預設格式印出；又 io.Writer 是什麼東西呢？它被定義在 `src/io/io.go` 之中：

```go
// Writer is the interface that wraps the basic Write method.
//                 
// Write writes len(p) bytes from p to the underlying data stream.
// It returns the number of bytes written from p (0 <= n <= len(p))
// and any error encountered that caused the write to stop early.
// Write must return a non-nil error if it returns n < len(p).
// Write must not modify the slice data, even temporarily.
//    
// Implementations must not retain p.
type Writer interface {
        Write(p []byte) (n int, err error)
}
```

筆者一直認為**介面（interface）**的觀念非常魔幻，和物件導向的概念很能夠相輔相成的一種感覺。物件導向是**物件**為主，包含了**成員變數**與**方法**。但是 GO 的介面的使用方式是**只定義方法的原型**，然後如果你有一個物件有那個方法，就能夠當作是符合該介面的一個物件。以現在的例子來看就是說，也許之後我們可以用 GO 語言寫嵌入式系統的機器人手臂，而這個機器人手臂（`RobotArm` 物件）內含有一個 `Write` 方法與 `io.Writer` 在這裡定義的完全相同，那麼任一個 `RobotArm` 變數都可以被當作是一個 `io.Writer` 的介面，因而可以出現：

```go
 rh := newRobotArm(...)
    fmt.Fprintln(rh, "Hello World!")
```

這樣的程式碼來讓機器人幫你寫出訊息。

#### `newPrinter` 函式

我們接著繼續看：

```go
...
func Fprintln(w io.Writer, a ...interface{}) (n int, err error) {
        p := newPrinter()
        p.doPrintln(a)
        n, err = w.Write(p.buf)
        p.free()
        return
}
```

`newPrinter` 函式顯然是接下來的一個重點操作。它被定義在 `src/fmt/print.go` 之中，

```go
// newPrinter allocates a new pp struct or grabs a cached one.
func newPrinter() *pp { 
        p := ppFree.Get().(*pp)
        p.panicking = false
        p.erroring = false
        p.fmt.init(&p.buf)
        return p
}
```

這裡的 `pp` 結構應該是想表達 `printer pool` 的資源池裡面最小單位。`ppFree` 的出身也很有趣：

```go
var ppFree = sync.Pool{
        New: func() interface{} { return new(pp) },
}
```

`sync.Pool`，也就是 `sync` 函式庫的 `Pool` 型別的物件。`Get()` 函式回傳的東西也是萬用的 `interface{}`，所以最後還把他轉回了 `*pp` 的型態並賦值給 p。`Get()` 函式內部在現在看來真的蠻嚇人的，裡面引用 `internal/race` 函式庫，執行像是** pin 住當前 goroutine 使之不要被搶佔（preempt）**的函式（簡直像是在看 kernel code）；最後的 `init` 函式就是將方才自資源池中取得的記憶體空間配給到物件內，然後清空一些既有的性質。

#### 印：`doPrintln`

```go
...
func Fprintln(w io.Writer, a ...interface{}) (n int, err error) {
        p := newPrinter()
        p.doPrintln(a)
        n, err = w.Write(p.buf)
        p.free()
        return
}
```

接下來就是要拿不定個數的傳數參數 `a`，**列印**到 `p.buf` 裡面去，這樣下一步才能夠單純透過 `w` 這個 `io.Writer` 介面的 `Write` 方法印出。這個抽象切得很具美感：printer 物件的 p 只管透過自己的資源與傳入參數，構成一塊連續空間的內容；`w` 是某個具有 `Write` 方法的不知名物件，它只需要負責操作該物件相關的方法來印出 `p.buf`。`doPrintln` 同樣在 `src/fmt/print.go` 之中：

```go
// doPrintln is like doPrint but always adds a space between arguments
// and a newline after the last argument.
func (p *pp) doPrintln(a []interface{}) {
        for argNum, arg := range a {
                if argNum > 0 {
                        p.buf.WriteByte(' ')
                }
                p.printArg(arg, 'v')
        }      
        p.buf.WriteByte('\n')
}
```

`for ... range` 的語法將 `a` 這個不定長度、不定內容的陣列切分開來。除了第一個元素之外，其餘的都必須前置空格。每個元素以 `printArg` 函式列印，並且...附帶一個 `v` 字元？然後最後印出換行符號。所以所有的魔術都在 `printArg` 裡面了。

這裡只列出一部份程式碼片段，說明其中邏輯：

```go
func (p *pp) printArg(arg interface{}, verb rune) {
    ...
        if arg == nil {
    ...
    // Special processing considerations.
        // %T (the value's type) and %p (its address) are special; we always do them first.
        switch verb {
    ...
            // Some types can be done without reflection.
        switch f := arg.(type) {
        case bool:         
                p.fmtBool(f, verb)
        case float32:      
                p.fmtFloat(float64(f), 32, verb)
        case float64:
    ...
```

最一開始判斷 `arg` 參數是否為空，是因為可以視情況給予 `<nil>` 之類的輸出結果。接下來是特殊格式字串的判定，即是 `%T` 和 `%p` 兩項，這兩者都需要特殊的函式來取得想要顯示的值。回頭看看，其實傳入的 `v` 字元也就是將 `Fprintln` 的傳入都視為 `%v` 的格式化字串，也就是按照預設格式輸出的意思。最後是通用的部份，透過 `arg` 參數的型別來判斷該做什麼樣的格式化。

我們的 Hello World 例子應該會在後面的字串部份進行格式化。

### 疑問

------------------------------------------------------------------------

- 追蹤過程中發現搶佔是可以被關掉的，也就是說 GO 語言有非同步的搶佔引擎。其機制為何？
- `arg.(type)` 這種功能被稱作 reflect。GO 語言的 reflect 是怎麼做的？
- `internal/race` 是怎麼樣的函式庫？功能？
- `sync` 是怎樣的函式庫？功能？

### 本日小結

------------------------------------------------------------------------

- 看了前半部的 `Fprintln` 函式，也就是整個字串形成的部份。

我們明天再來看 `Write` 的部份進行哪些操作。感謝各位讀者，我們明天再會！
