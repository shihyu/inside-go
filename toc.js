// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><a href="index.html"><strong aria-hidden="true">1.</strong> 首頁</a></li><li class="chapter-item expanded "><a href="day-01.html"><strong aria-hidden="true">2.</strong> Day 01 第一天：本系列方向與寫作計畫</a></li><li class="chapter-item expanded "><a href="day-02.html"><strong aria-hidden="true">3.</strong> Day 02 第二天：進入 Hello World!</a></li><li class="chapter-item expanded "><a href="day-03.html"><strong aria-hidden="true">4.</strong> Day 03 第三天：追蹤 os.Stdout</a></li><li class="chapter-item expanded "><a href="day-04.html"><strong aria-hidden="true">5.</strong> Day 04 第四天：拆解 Println</a></li><li class="chapter-item expanded "><a href="day-05.html"><strong aria-hidden="true">6.</strong> Day 05 第五天：Fprintln 後半</a></li><li class="chapter-item expanded "><a href="day-06.html"><strong aria-hidden="true">7.</strong> Day 06 第六天：暫停一下回顧未解問題</a></li><li class="chapter-item expanded "><a href="day-07.html"><strong aria-hidden="true">8.</strong> Day 07 第七天：瀏覽系統相依的初始化</a></li><li class="chapter-item expanded "><a href="day-08.html"><strong aria-hidden="true">9.</strong> Day 08 第八天：進入 schedinit</a></li><li class="chapter-item expanded "><a href="day-09.html"><strong aria-hidden="true">10.</strong> Day 09 第九天：進入 schedinit （之二）</a></li><li class="chapter-item expanded "><a href="day-10.html"><strong aria-hidden="true">11.</strong> Day 10 第十天：初遇 GO 語言密碼：G、M、P？</a></li><li class="chapter-item expanded "><a href="day-11.html"><strong aria-hidden="true">12.</strong> Day 11 第十一天：繼續奮戰 schedinit</a></li><li class="chapter-item expanded "><a href="day-12.html"><strong aria-hidden="true">13.</strong> Day 12 第十二天：簡單除錯 GO 語言程式</a></li><li class="chapter-item expanded "><a href="day-13.html"><strong aria-hidden="true">14.</strong> Day 13 第十三天：更多除錯訊息</a></li><li class="chapter-item expanded "><a href="day-14.html"><strong aria-hidden="true">15.</strong> Day 14 第十四天：schedinit 告一段落</a></li><li class="chapter-item expanded "><a href="day-15.html"><strong aria-hidden="true">16.</strong> Day 15 第十五天：追蹤 newproc</a></li><li class="chapter-item expanded "><a href="day-16.html"><strong aria-hidden="true">17.</strong> Day 16 第十六天：newproc1 之前的堆疊準備動作</a></li><li class="chapter-item expanded "><a href="day-17.html"><strong aria-hidden="true">18.</strong> Day 17 第十七天：看看 systemstack 函式呼叫</a></li><li class="chapter-item expanded "><a href="day-18.html"><strong aria-hidden="true">19.</strong> Day 18 第十八天：GO 語言運行模型的三項之力</a></li><li class="chapter-item expanded "><a href="day-19.html"><strong aria-hidden="true">20.</strong> Day 19 第十九天：G 的取得路徑</a></li><li class="chapter-item expanded "><a href="day-20.html"><strong aria-hidden="true">21.</strong> Day 20 第二十天：新生 goroutine 的初始狀態</a></li><li class="chapter-item expanded "><a href="day-21.html"><strong aria-hidden="true">22.</strong> Day 21 第二十一天：配置新的 goroutine</a></li><li class="chapter-item expanded "><a href="day-22.html"><strong aria-hidden="true">23.</strong> Day 22 第二十二天：領取號碼牌</a></li><li class="chapter-item expanded "><a href="day-23.html"><strong aria-hidden="true">24.</strong> Day 23 第二十三天：開始排隊</a></li><li class="chapter-item expanded "><a href="day-24.html"><strong aria-hidden="true">25.</strong> Day 24 第二十四天：上膛的 goroutine</a></li><li class="chapter-item expanded "><a href="day-25.html"><strong aria-hidden="true">26.</strong> Day 25 第二十五天：minit 與 signal 設置</a></li><li class="chapter-item expanded "><a href="day-26.html"><strong aria-hidden="true">27.</strong> Day 26 第二十六天：signal 初始化收尾</a></li><li class="chapter-item expanded "><a href="day-27.html"><strong aria-hidden="true">28.</strong> Day 27 第二十七天：goroutine 執行中</a></li><li class="chapter-item expanded "><a href="day-28.html"><strong aria-hidden="true">29.</strong> Day 28 第二十八天：其他的 M 登場</a></li><li class="chapter-item expanded "><a href="day-29.html"><strong aria-hidden="true">30.</strong> Day 29 第二十九天：終點的 main.main</a></li><li class="chapter-item expanded "><a href="day-30.html"><strong aria-hidden="true">31.</strong> Day 30 第三十天：繼續前進</a></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
