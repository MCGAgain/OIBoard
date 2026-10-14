package store

// SegNode 线段树节点，维护区间内的代码行数聚合统计
type SegNode struct {
	TotalLines int
	CLines     int
	CFiles     int
	CPPLines   int
	CPPFiles   int
	JavaLines  int
	JavaFiles  int
	FileCount  int
}

func mergeNodes(a, b SegNode) SegNode {
	return SegNode{
		TotalLines: a.TotalLines + b.TotalLines,
		CLines:     a.CLines + b.CLines,
		CFiles:     a.CFiles + b.CFiles,
		CPPLines:   a.CPPLines + b.CPPLines,
		CPPFiles:   a.CPPFiles + b.CPPFiles,
		JavaLines:  a.JavaLines + b.JavaLines,
		JavaFiles:  a.JavaFiles + b.JavaFiles,
		FileCount:  a.FileCount + b.FileCount,
	}
}

// SegmentTree 非递归高性能线段树（zkw 线段树），支持 O(log N) 单点更新与 O(1) 全局聚合查询
type SegmentTree struct {
	n    int
	tree []SegNode
}

// NewSegmentTree 初始化线段树，默认容量至少为 32
func NewSegmentTree(maxFiles int) *SegmentTree {
	if maxFiles < 32 {
		maxFiles = 32
	}
	n := 1
	for n < maxFiles {
		n <<= 1
	}
	return &SegmentTree{
		n:    n,
		tree: make([]SegNode, 2*n),
	}
}

// EnsureCapacity 动态扩容线段树
func (st *SegmentTree) EnsureCapacity(required int) {
	if required <= st.n {
		return
	}
	newN := st.n
	for newN < required {
		newN <<= 1
	}
	newTree := make([]SegNode, 2*newN)
	// 将原叶节点迁移到新树的对应叶子位置
	for i := 0; i < st.n; i++ {
		newTree[newN+i] = st.tree[st.n+i]
	}
	// 向上 pushup 重构内部节点
	for i := newN - 1; i > 0; i-- {
		newTree[i] = mergeNodes(newTree[i<<1], newTree[i<<1|1])
	}
	st.n = newN
	st.tree = newTree
}

// UpdatePoint 单点更新：将指定文件 ID 的行数与语言更新到线段树 (pos 为 1-indexed)
func (st *SegmentTree) UpdatePoint(pos int, lines int, lang string, active bool) {
	if pos <= 0 {
		return
	}
	st.EnsureCapacity(pos)

	idx := st.n + pos - 1
	if !active {
		st.tree[idx] = SegNode{}
	} else {
		node := SegNode{
			TotalLines: lines,
			FileCount:  1,
		}
		switch lang {
		case "c":
			node.CLines = lines
			node.CFiles = 1
		case "cpp":
			node.CPPLines = lines
			node.CPPFiles = 1
		case "java":
			node.JavaLines = lines
			node.JavaFiles = 1
		}
		st.tree[idx] = node
	}

	// 向上回溯更新祖先节点
	for idx >>= 1; idx > 0; idx >>= 1 {
		st.tree[idx] = mergeNodes(st.tree[idx<<1], st.tree[idx<<1|1])
	}
}

// QueryTotal O(1) 获取全局聚合统计
func (st *SegmentTree) QueryTotal() SegNode {
	if len(st.tree) < 2 {
		return SegNode{}
	}
	return st.tree[1]
}

// QueryRange O(log N) 查询区间 [l, r] (1-indexed, 闭区间)
func (st *SegmentTree) QueryRange(l, r int) SegNode {
	if l < 1 {
		l = 1
	}
	if r > st.n {
		r = st.n
	}
	if l > r {
		return SegNode{}
	}

	resL := SegNode{}
	resR := SegNode{}

	l = st.n + l - 1
	r = st.n + r
	for l < r {
		if l&1 == 1 {
			resL = mergeNodes(resL, st.tree[l])
			l++
		}
		if r&1 == 1 {
			r--
			resR = mergeNodes(st.tree[r], resR)
		}
		l >>= 1
		r >>= 1
	}
	return mergeNodes(resL, resR)
}
