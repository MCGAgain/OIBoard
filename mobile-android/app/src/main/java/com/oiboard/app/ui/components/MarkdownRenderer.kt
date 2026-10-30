package com.oiboard.app.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed class MarkdownBlock {
    data class Header(val level: Int, val annotatedText: AnnotatedString) : MarkdownBlock()
    data class Paragraph(val annotatedText: AnnotatedString) : MarkdownBlock()
    data class Blockquote(val annotatedText: AnnotatedString) : MarkdownBlock()
    data class ListItem(val bullet: String, val annotatedText: AnnotatedString) : MarkdownBlock()
    data class CodeBlock(
        val language: String,
        val rawCode: String,
        val precomputedLines: List<AnnotatedString>,
        val isTruncated: Boolean
    ) : MarkdownBlock()
    object Divider : MarkdownBlock()
}

/**
 * 轻量原生 Compose Markdown 解析器与渲染组件
 * - 解析在 Dispatchers.Default 后台协程执行，通过 remember 缓存
 * - 针对代码块做语法词法预处理，绘制阶段绝对零分配
 * - 嵌入 LazyColumn 懒加载，支持水平滑动与超长代码截断保护
 */
@Composable
fun rememberMarkdownBlocks(
    markdownContent: String,
    isDark: Boolean = isSystemInDarkTheme()
): List<MarkdownBlock> {
    var blocks by remember(markdownContent, isDark) { mutableStateOf<List<MarkdownBlock>>(emptyList()) }

    LaunchedEffect(markdownContent, isDark) {
        blocks = withContext(Dispatchers.Default) {
            parseMarkdownToBlocks(markdownContent, isDark)
        }
    }

    return blocks
}

fun LazyListScope.markdownContent(
    blocks: List<MarkdownBlock>,
    onOpenUrl: (String) -> Unit
) {
    items(blocks) { block ->
        MarkdownBlockItem(block = block, onOpenUrl = onOpenUrl)
    }
}

@Composable
fun MarkdownBlockItem(
    block: MarkdownBlock,
    onOpenUrl: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    when (block) {
        is MarkdownBlock.Header -> {
            val (fontSize, topPadding) = when (block.level) {
                1 -> 18.sp to 12.dp
                2 -> 16.sp to 10.dp
                else -> 14.sp to 8.dp
            }
            Column(modifier = modifier.padding(top = topPadding, bottom = 4.dp)) {
                Text(
                    text = block.annotatedText,
                    fontSize = fontSize,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    lineHeight = (fontSize.value * 1.3).sp
                )
            }
        }
        is MarkdownBlock.Paragraph -> {
            Box(modifier = modifier.padding(vertical = 3.dp)) {
                ClickableAnnotatedText(
                    annotatedText = block.annotatedText,
                    onOpenUrl = onOpenUrl
                )
            }
        }
        is MarkdownBlock.Blockquote -> {
            Row(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .height(20.dp)
                        .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp))
                )
                Spacer(modifier = Modifier.width(8.dp))
                ClickableAnnotatedText(
                    annotatedText = block.annotatedText,
                    onOpenUrl = onOpenUrl
                )
            }
        }
        is MarkdownBlock.ListItem -> {
            Row(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.Top
            ) {
                Text(
                    text = block.bullet,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.width(22.dp)
                )
                ClickableAnnotatedText(
                    annotatedText = block.annotatedText,
                    onOpenUrl = onOpenUrl
                )
            }
        }
        is MarkdownBlock.Divider -> {
            HorizontalDivider(
                modifier = modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                thickness = 1.dp
            )
        }
        is MarkdownBlock.CodeBlock -> {
            CodeBlockContainer(
                block = block,
                onCopy = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("code", block.rawCode))
                    Toast.makeText(context, "代码已复制到剪贴板", Toast.LENGTH_SHORT).show()
                },
                modifier = modifier
            )
        }
    }
}

@Composable
private fun ClickableAnnotatedText(
    annotatedText: AnnotatedString,
    onOpenUrl: (String) -> Unit
) {
    Text(
        text = annotatedText,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        color = MaterialTheme.colorScheme.onSurface
    )
}

@Composable
private fun CodeBlockContainer(
    block: MarkdownBlock.CodeBlock,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = isSystemInDarkTheme()
    val bgColor = if (isDark) Color(0xFF1E1E2E) else Color(0xFFF6F8FA)
    val borderColor = if (isDark) Color(0xFF313244) else Color(0xFFE1E4E8)
    val headerBgColor = if (isDark) Color(0xFF181825) else Color(0xFFEBEEF2)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, borderColor, RoundedCornerShape(10.dp))
            .background(bgColor)
    ) {
        // 顶栏：语言徽标与复制按钮
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(headerBgColor)
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = block.language.uppercase().ifBlank { "CODE" },
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                fontFamily = FontFamily.Monospace
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                if (block.isTruncated) {
                    Icon(
                        imageVector = Icons.Outlined.Warning,
                        contentDescription = "已截断",
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "已截断超长代码",
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }

                IconButton(
                    onClick = onCopy,
                    modifier = Modifier.size(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.ContentCopy,
                        contentDescription = "复制完整代码",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }
        }

        // 代码内容区（水平滚动）
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(12.dp)
        ) {
            Column {
                block.precomputedLines.forEach { line ->
                    Text(
                        text = line,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                        color = if (isDark) Color(0xFFABB2BF) else Color(0xFF383A42),
                        softWrap = false
                    )
                }
            }
        }
    }
}

/**
 * Markdown 行级块解析器
 */
private fun parseMarkdownToBlocks(content: String, isDark: Boolean): List<MarkdownBlock> {
    if (content.isBlank()) return emptyList()

    val lines = content.lines()
    val blocks = mutableListOf<MarkdownBlock>()
    var i = 0
    val total = lines.size

    val maxCodeLines = 400

    while (i < total) {
        val line = lines[i]
        val trimmed = line.trim()

        // 1. 代码块 ```
        if (trimmed.startsWith("```")) {
            val lang = trimmed.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            i++
            while (i < total && !lines[i].trim().startsWith("```")) {
                codeLines.add(lines[i])
                i++
            }
            // 跳过闭合的 ```
            if (i < total) i++

            val isTruncated = codeLines.size > maxCodeLines
            val slice = if (isTruncated) codeLines.take(maxCodeLines) else codeLines
            val rawCode = codeLines.joinToString("\n")

            val precomputed = slice.map { codeLine ->
                precomputeCodeSyntaxHighlight(codeLine, lang, isDark)
            }

            blocks.add(
                MarkdownBlock.CodeBlock(
                    language = lang,
                    rawCode = rawCode,
                    precomputedLines = precomputed,
                    isTruncated = isTruncated
                )
            )
            continue
        }

        // 2. 空行
        if (trimmed.isEmpty()) {
            i++
            continue
        }

        // 3. 分隔线 (---, ***, ___)
        if (trimmed == "---" || trimmed == "***" || trimmed == "___") {
            blocks.add(MarkdownBlock.Divider)
            i++
            continue
        }

        // 4. 标题 (#, ##, ###)
        if (trimmed.startsWith("#")) {
            val level = trimmed.takeWhile { it == '#' }.length.coerceIn(1, 3)
            val headerText = trimmed.substring(level).trim()
            blocks.add(
                MarkdownBlock.Header(
                    level = level,
                    annotatedText = parseInlineMarkdown(headerText, isDark)
                )
            )
            i++
            continue
        }

        // 5. 引用 (> )
        if (trimmed.startsWith(">")) {
            val quoteText = trimmed.removePrefix(">").trim()
            blocks.add(
                MarkdownBlock.Blockquote(
                    annotatedText = parseInlineMarkdown(quoteText, isDark)
                )
            )
            i++
            continue
        }

        // 6. 无序列表 (- , * , + )
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
            val listText = trimmed.substring(2).trim()
            blocks.add(
                MarkdownBlock.ListItem(
                    bullet = "•",
                    annotatedText = parseInlineMarkdown(listText, isDark)
                )
            )
            i++
            continue
        }

        // 7. 有序列表 (1. , 2. )
        val orderedMatch = Regex("""^(\d+)\.\s+(.*)""").find(trimmed)
        if (orderedMatch != null) {
            val num = orderedMatch.groupValues[1]
            val text = orderedMatch.groupValues[2]
            blocks.add(
                MarkdownBlock.ListItem(
                    bullet = "$num.",
                    annotatedText = parseInlineMarkdown(text, isDark)
                )
            )
            i++
            continue
        }

        // 8. 普通段落
        blocks.add(
            MarkdownBlock.Paragraph(
                annotatedText = parseInlineMarkdown(trimmed, isDark)
            )
        )
        i++
    }

    return blocks
}

/**
 * 行内 Markdown 解析 (粗体, 斜体, 行内代码, 链接)
 */
private fun parseInlineMarkdown(text: String, isDark: Boolean): AnnotatedString {
    return buildAnnotatedString {
        var idx = 0
        val len = text.length

        val linkColor = if (isDark) Color(0xFF61AFEF) else Color(0xFF0366D6)
        val codeBgColor = if (isDark) Color(0xFF2C313C) else Color(0xFFEBEEF2)
        val codeTextColor = if (isDark) Color(0xFFE06C75) else Color(0xFFD73A49)

        while (idx < len) {
            // 1. 行内代码 `code`
            if (text[idx] == '`') {
                val endIdx = text.indexOf('`', idx + 1)
                if (endIdx != -1) {
                    val codeContent = text.substring(idx + 1, endIdx)
                    withStyle(
                        SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            color = codeTextColor,
                            background = codeBgColor,
                            fontSize = 11.sp
                        )
                    ) {
                        append(" $codeContent ")
                    }
                    idx = endIdx + 1
                    continue
                }
            }

            // 2. 链接 [label](url)
            if (text[idx] == '[') {
                val closeBracket = text.indexOf(']', idx + 1)
                if (closeBracket != -1 && closeBracket + 1 < len && text[closeBracket + 1] == '(') {
                    val closeParen = text.indexOf(')', closeBracket + 2)
                    if (closeParen != -1) {
                        val label = text.substring(idx + 1, closeBracket)
                        val url = text.substring(closeBracket + 2, closeParen)
                        withStyle(
                            SpanStyle(
                                color = linkColor,
                                textDecoration = TextDecoration.Underline,
                                fontWeight = FontWeight.SemiBold
                            )
                        ) {
                            append(label)
                        }
                        idx = closeParen + 1
                        continue
                    }
                }
            }

            // 3. 粗斜体 ***text*** 或 ___text___
            if (text.startsWith("***", idx) || text.startsWith("___", idx)) {
                val marker = text.substring(idx, idx + 3)
                val endIdx = text.indexOf(marker, idx + 3)
                if (endIdx != -1) {
                    val boldItalicContent = text.substring(idx + 3, endIdx)
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic)) {
                        append(boldItalicContent)
                    }
                    idx = endIdx + 3
                    continue
                }
            }

            // 4. 粗体 **text** 或 __text__
            if (text.startsWith("**", idx) || text.startsWith("__", idx)) {
                val marker = text.substring(idx, idx + 2)
                val endIdx = text.indexOf(marker, idx + 2)
                if (endIdx != -1) {
                    val boldContent = text.substring(idx + 2, endIdx)
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(boldContent)
                    }
                    idx = endIdx + 2
                    continue
                }
            }

            // 5. 斜体 *text* 或 _text_
            if ((text[idx] == '*' || text[idx] == '_') && idx + 1 < len && text[idx + 1] != ' ') {
                val marker = text[idx]
                val endIdx = text.indexOf(marker, idx + 1)
                if (endIdx != -1) {
                    val italicContent = text.substring(idx + 1, endIdx)
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(italicContent)
                    }
                    idx = endIdx + 1
                    continue
                }
            }

            // 普通字符
            append(text[idx])
            idx++
        }
    }
}

// 常见 C/C++/Python/Java 基础关键字集合
private val KEYWORDS = setOf(
    "int", "long", "double", "float", "char", "bool", "void", "auto",
    "if", "else", "for", "while", "do", "return", "break", "continue",
    "struct", "class", "public", "private", "protected", "namespace",
    "using", "std", "include", "define", "template", "typename",
    "const", "static", "new", "delete", "sizeof", "true", "false",
    "nullptr", "NULL", "signed", "unsigned", "typedef", "pair", "vector",
    "def", "import", "from", "self", "elif", "pass", "in", "is", "not",
    "and", "or", "lambda", "None", "True", "False"
)

/**
 * 极轻量基础词法高亮预计算（C++/Python 等），在后台线程预生成，绘制阶段零分配
 */
private fun precomputeCodeSyntaxHighlight(line: String, lang: String, isDark: Boolean): AnnotatedString {
    val kwColor = if (isDark) Color(0xFFC678DD) else Color(0xFFA626A4)
    val strColor = if (isDark) Color(0xFF98C379) else Color(0xFF50A14F)
    val commentColor = if (isDark) Color(0xFF5C6370) else Color(0xFFA0A1A7)
    val numColor = if (isDark) Color(0xFFD19A66) else Color(0xFF986801)
    val preprocessorColor = if (isDark) Color(0xFF61AFEF) else Color(0xFF0366D6)

    return buildAnnotatedString {
        val trimmed = line.trimStart()

        // 1. 全行注释判断 // 或 #
        if (trimmed.startsWith("//") || (lang.lowercase() in listOf("python", "py", "sh") && trimmed.startsWith("#"))) {
            withStyle(SpanStyle(color = commentColor, fontStyle = FontStyle.Italic)) {
                append(line)
            }
            return@buildAnnotatedString
        }

        // 2. 预处理指令 #include, #define
        if (trimmed.startsWith("#")) {
            withStyle(SpanStyle(color = preprocessorColor, fontWeight = FontWeight.Bold)) {
                append(line)
            }
            return@buildAnnotatedString
        }

        // 3. 基础单词流扫描
        var i = 0
        val len = line.length

        while (i < len) {
            val c = line[i]

            // 行内注释 //
            if (c == '/' && i + 1 < len && line[i + 1] == '/') {
                withStyle(SpanStyle(color = commentColor, fontStyle = FontStyle.Italic)) {
                    append(line.substring(i))
                }
                break
            }

            // 字符串字面量 "..."
            if (c == '"' || c == '\'') {
                val endQuote = line.indexOf(c, i + 1)
                if (endQuote != -1) {
                    withStyle(SpanStyle(color = strColor)) {
                        append(line.substring(i, endQuote + 1))
                    }
                    i = endQuote + 1
                    continue
                }
            }

            // 标识符或关键字
            if (c.isLetter() || c == '_') {
                val start = i
                while (i < len && (line[i].isLetterOrDigit() || line[i] == '_')) {
                    i++
                }
                val word = line.substring(start, i)
                if (word in KEYWORDS) {
                    withStyle(SpanStyle(color = kwColor, fontWeight = FontWeight.Bold)) {
                        append(word)
                    }
                } else {
                    append(word)
                }
                continue
            }

            // 数字字面量
            if (c.isDigit()) {
                val start = i
                while (i < len && (line[i].isLetterOrDigit() || line[i] == '.')) {
                    i++
                }
                withStyle(SpanStyle(color = numColor)) {
                    append(line.substring(start, i))
                }
                continue
            }

            // 其他普通字符
            append(c)
            i++
        }
    }
}
