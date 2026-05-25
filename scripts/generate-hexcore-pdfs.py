from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
ICON_SRC_DIR = ROOT / "public" / "assets" / "hex-icons"
ICON_CACHE_DIR = TMP_DIR / "hex-icons"
PREVIEW_DIR = TMP_DIR / "previews"
SAMPLE_DATA = ROOT / "src" / "core" / "sample-data.js"

FONT_REGULAR = Path(r"C:\Windows\Fonts\Deng.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\Dengb.ttf")
FONT_FALLBACK = Path(r"C:\Windows\Fonts\simhei.ttf")

CAT_INFO = {
    "shop_control": {
        "label": "商店操控类",
        "brief": "改变商店展示、刷新、保留、替换或商店质量。",
        "color": colors.HexColor("#168aad"),
    },
    "economy": {
        "label": "金币运营类",
        "brief": "影响金币收入、购买折扣、返还或刷新资源。",
        "color": colors.HexColor("#c88719"),
    },
    "disruption": {
        "label": "对手干扰类",
        "brief": "干扰其他队长的商店、金币、信息或行动窗口。",
        "color": colors.HexColor("#7c3aed"),
    },
    "roster_replace": {
        "label": "入队替代类",
        "brief": "用普通购买以外的方式获得、替换或重构队员。",
        "color": colors.HexColor("#0f766e"),
    },
    "order_response": {
        "label": "顺位响应类",
        "brief": "改变行动顺位，或在关键购买发生后响应。",
        "color": colors.HexColor("#c2410c"),
    },
}

CAT_ORDER = ["shop_control", "economy", "disruption", "roster_replace", "order_response"]

TYPE_LABEL = {
    "cyan": "青色",
    "amber": "金色",
    "violet": "紫色",
}

TAG_LABEL = {
    "shop": "商店",
    "camp": "阵营",
    "economy": "经济",
    "discount": "折扣",
    "refresh": "刷新",
    "replace": "替换",
    "target": "目标",
    "direct_roster": "直接入队",
    "gold": "金币",
    "acquire": "获得时",
    "refund": "返还",
    "round_start": "轮初",
    "steal": "夺取",
    "team_swap": "阵容重构",
    "round_income": "轮次收入",
    "high_tier": "高费",
    "order": "顺位",
    "random": "随机",
    "tier4": "4费",
    "tier5": "5费",
    "delay": "延迟",
    "weather": "天气",
    "blind": "暗信息",
    "response": "响应",
}

TIMING_BY_ID = {
    "camp-scout": "开店前",
    "discount-coupon": "商店打开后、购买前",
    "reserved-seat": "商店打开后、刷新前",
    "urgent-restock": "商店打开后、购买前",
    "camp-blockade": "当前队长手动发动",
    "price-interference": "当前队长手动发动",
    "steady-reinforce": "跳过购买前",
    "donation": "获得该海克斯时",
    "sponsor-flow": "购买费用不低于3时",
    "hungry-wave": "每轮开始随机触发",
    "last-stand": "手动发动",
    "open-feast": "第3轮开始",
    "vampiric-habit": "当前队长手动发动",
    "giant-slayer": "首次购买4费或5费卡时",
    "ballroom-queen": "本轮商店生成时",
    "photographer": "刷新商店时",
    "wise-benevolence": "自己的选人阶段开始",
    "origin-sage": "每轮开始自动提顺位",
    "mystery-box": "购买阶段手动发动",
    "transmute-gold": "商店打开前",
    "transmute-prismatic": "商店打开前",
    "decompose-knowledge": "满3层后手动发动",
    "stuck-together": "指定后在下一轮开始判定",
    "storm-fog": "当前队长手动发动",
    "snow-cat": "当前队长手动发动",
    "charged-cannon": "每轮一次，顺位窗口内",
    "heavenly-descent": "他人确认购买后的10秒内",
}

TARGET_BY_ID = {
    "camp-scout": "自己下一次商店",
    "discount-coupon": "自己本次购买",
    "steady-reinforce": "自己同阵营最低可用费用池",
    "donation": "自己",
    "sponsor-flow": "自己购买后的返还",
    "hungry-wave": "随机命中本轮其他购买",
    "last-stand": "自己的当前4名队员，以及全场本阵营合法非队长候选",
    "open-feast": "自己",
    "vampiric-habit": "金币余额最高的三名其他队长",
    "giant-slayer": "自己首次购买的4费和5费卡",
    "ballroom-queen": "自己本轮商店",
    "photographer": "自己每轮刷新",
    "wise-benevolence": "自己",
    "origin-sage": "自己本轮顺位",
    "mystery-box": "自己同阵营2-5费可选池",
    "transmute-gold": "自己同阵营4费可选池",
    "transmute-prismatic": "自己同阵营5费可选池",
    "stuck-together": "同阵营、费用不高于当前上限且未入队的可选选手",
    "storm-fog": "起点队长，随后按顺位环形影响最多3名仍有购买权且未满员的非使用者队长",
    "snow-cat": "非自己的任意队长",
    "charged-cannon": "自己，或一名可被雷霆一击后移的其他队长",
    "heavenly-descent": "刚被其他队长购买的同阵营选手",
}

TIPS_BY_ID = {
    "snow-cat": ["适合干扰正在找关键卡的其他队长，不能对自己使用。", "费用不参与身份打乱，购买后才揭示真实选手。"],
    "heavenly-descent": ["适合反制对手刚买到的同阵营高费关键卡，跨阵营目标不能发动。", "发动者最好预留队伍空位；成功入队后会跳过下一轮选人。"],
    "hungry-wave": ["高风险延迟收益，触发者会失去金币并跳过本轮。", "命中同阵营购买时收益最高。"],
    "origin-sage": ["适合想抢轮初优先权的队伍。", "若已经处于第一顺位，不会重复改变顺位。"],
    "decompose-knowledge": ["满3层后再选择高价值目标，收益更稳定。", "金币不足时可分解2/3费队员抵扣。"],
    "stuck-together": ["适合提前锁定同阵营关键选手，选择列表会标注费用，跨阵营目标不能选择。", "目标受本轮费用上限限制，被其他规则拿走时会失效。"],
    "charged-cannon": ["雷霆一击延后对手，加速之门提升自己。", "每轮最多一次，使用前确认当前顺位。"],
    "camp-scout": ["开店前使用收益最高，适合想提高同阵营可见卡数量时使用。"],
    "discount-coupon": ["留给高费卡更划算，但最低只能降到1金币。"],
    "reserved-seat": ["看到想要但暂时不买时使用，刷新时保留关键卡。"],
    "urgent-restock": ["当前卡不满意但费用合适时使用，尝试换同阵营同费用另一人。"],
    "camp-blockade": ["优先干扰还没行动且正在找关键卡的队长。"],
    "price-interference": ["适合抬高对手关键购买成本，可能迫使对方刷新或跳过。"],
    "steady-reinforce": ["金币紧张或商店不理想时，用购买权换稳定补人。"],
    "donation": ["开局经济更宽裕，适合前两轮更主动找牌。"],
    "sponsor-flow": ["连续购买3费以上时收益稳定。"],
    "last-stand": ["阵容质量明显落后且已有4名队员时再考虑，波动很大。", "只能在本阵营范围内置换，不会跨阵营拿人。"],
    "open-feast": ["第3轮爆发型经济，适合中后段冲高费。"],
    "vampiric-habit": ["对金币富余的队长更有效。"],
    "giant-slayer": ["保留给第一次买4费和5费时触发，等同于高费折扣。"],
    "ballroom-queen": ["更容易看到高费卡，但低费补强能力下降。"],
    "photographer": ["每轮多一次免费刷新，适合主动找关键卡。"],
    "wise-benevolence": ["越到后期金币和累计刷新价值越高。"],
    "mystery-box": ["用3金币换随机同阵营2-5费，适合普通商店找不到人时。"],
    "transmute-gold": ["直接冲4费，适合中后期补强。"],
    "transmute-prismatic": ["直接冲5费，收益高但依赖同阵营可选池。"],
    "storm-fog": ["用于连续影响多个后续行动队长，适合关键轮次压节奏。", "只影响拥有购买权的队伍；无购买权时跳过，购买权恢复后继续响应。"],
}

SPECIAL_JUDGE_NOTES = {
    "camp-scout": ["必须在开店前使用。", "商店额外展示1张，但仍只能买1人。"],
    "discount-coupon": ["只影响本次购买。", "折后费用最低为1金币。"],
    "reserved-seat": ["目标必须是当前商店卡。", "购买、跳过或进入下一位队长后失效。"],
    "urgent-restock": ["替换目标必须同阵营、同费用、当前商店外。", "找不到替换目标时拒绝。"],
    "camp-blockade": ["目标下一次商店少1张，最低3张。", "若目标本轮已行动，延迟到下轮。"],
    "price-interference": ["目标下一次购买费用+1，无上限。", "只在一次购买结算中生效。"],
    "steady-reinforce": ["会消耗本轮购买权。", "只能从同阵营最低可用费用池随机分配。"],
    "hungry-wave": ["触发者金币清零并跳过本轮。", "命中同阵营则夺取，命中异阵营则退回购买并轮末补偿。", "持有者不受顺位类和目标型干扰影响。"],
    "last-stand": ["必须已有4名队员才可发动。", "会放弃当前4名队员并重构阵容。", "候选只来自本阵营，排除禁用、队长、当前4名队员和海浪我没吃饭队伍当前阵容。", "抽中别队队员时，该队从原4人中随机获得1名补偿；抽中可选池选手时不置换。"],
    "heavenly-descent": ["必须在购买后10秒响应窗口内处理。", "只能夺取发动者同阵营选手，跨阵营购买不可发动。", "发动者未满员则直接入队，并跳过下一轮选人；满员则目标回到卡池。", "原购买队长返还金币和购买权，不返还刷新次数。"],
    "decompose-knowledge": ["每个选人阶段最多叠到3层。", "发动后消耗全部3层。"],
    "stuck-together": ["目标必须同阵营、费用不高于当前上限、未被选走且不能是队长。", "指定目标后延迟到下一轮选人开始判定。", "目标若已离开卡池则失效。"],
    "storm-fog": ["按顺位环形向后影响最多3名仍有购买权且未满员的非使用者队长。", "本轮不足3名合法目标时顺延到下一轮。", "刷新商店不会清除血雾；没有购买权的队伍跳过，购买权恢复后继续响应。"],
    "snow-cat": ["不能对自己使用，只能选择其他未满员队长。", "目标下一次商店身份信息打乱。", "费用不参与打乱，仍按真实卡位费用显示和扣款；购买后才揭示真实选手。"],
    "charged-cannon": ["转换技二选一。", "每轮最多使用1次。", "神秘贤者·启元先结算，大炮后结算。", "雷霆一击不能指定自己、最后顺位、启元保护或提位队长，也不能指定海浪我没吃饭持有者。"],
    "origin-sage": ["获得时初始资金+2。", "每轮开始自动提到第一顺位，无需裁判手动执行。"],
}


def ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


def register_fonts() -> None:
    regular = FONT_REGULAR if FONT_REGULAR.exists() else FONT_FALLBACK
    bold = FONT_BOLD if FONT_BOLD.exists() else FONT_FALLBACK
    pdfmetrics.registerFont(TTFont("CN", str(regular)))
    pdfmetrics.registerFont(TTFont("CN-Bold", str(bold)))
    pdfmetrics.registerFontFamily("CN", normal="CN", bold="CN-Bold")


def run_node_json(script: str) -> list[dict]:
    node = os.environ.get("NODE", "node")
    result = subprocess.run(
        [node, "-e", script],
        cwd=ROOT,
        check=True,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    return json.loads(result.stdout)


def load_hexcores() -> list[dict]:
    js = r"""
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('src/core/sample-data.js', 'utf8');
const match = src.match(/const hexcores = (\[[\s\S]*?\n  \]);/);
if (!match) throw new Error('未找到 hexcores 定义');
const hexcores = vm.runInNewContext(match[1]);
console.log(JSON.stringify(hexcores));
"""
    hexcores = run_node_json(js)
    return sorted(hexcores, key=lambda item: (CAT_ORDER.index(item.get("category", "shop_control")), item["name"]))


def validate_icons(hexcores: list[dict]) -> None:
    missing = []
    for hexcore in hexcores:
        icon = ICON_SRC_DIR / f"{hexcore['id']}.png"
        if not icon.exists():
            missing.append(str(icon))
    if missing:
        raise FileNotFoundError("缺少海克斯图标：\n" + "\n".join(missing))


def build_icon_cache(hexcores: list[dict]) -> None:
    for hexcore in hexcores:
        src = ICON_SRC_DIR / f"{hexcore['id']}.png"
        dst = ICON_CACHE_DIR / f"{hexcore['id']}.png"
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            continue
        with PILImage.open(src) as image:
            image = image.convert("RGBA")
            image.thumbnail((192, 192), PILImage.Resampling.LANCZOS)
            canvas = PILImage.new("RGBA", (192, 192), (255, 255, 255, 0))
            x = (192 - image.width) // 2
            y = (192 - image.height) // 2
            canvas.alpha_composite(image, (x, y))
            canvas.save(dst)


def styles():
    base = ParagraphStyle(
        "base",
        fontName="CN",
        fontSize=9.2,
        leading=13,
        textColor=colors.HexColor("#172033"),
        wordWrap="CJK",
        splitLongWords=True,
    )
    return {
        "base": base,
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base,
            fontName="CN-Bold",
            fontSize=27,
            leading=34,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#0f172a"),
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base,
            fontSize=12,
            leading=18,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#475569"),
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base,
            fontName="CN-Bold",
            fontSize=17,
            leading=24,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=6,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base,
            fontName="CN-Bold",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#111827"),
            spaceBefore=4,
            spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base,
            fontName="CN-Bold",
            fontSize=10.5,
            leading=14,
            textColor=colors.HexColor("#111827"),
        ),
        "small": ParagraphStyle(
            "small",
            parent=base,
            fontSize=7.6,
            leading=10.4,
            textColor=colors.HexColor("#475569"),
        ),
        "tiny": ParagraphStyle(
            "tiny",
            parent=base,
            fontSize=6.8,
            leading=8.8,
            textColor=colors.HexColor("#475569"),
        ),
        "white": ParagraphStyle(
            "white",
            parent=base,
            fontName="CN-Bold",
            fontSize=8,
            leading=10,
            alignment=TA_CENTER,
            textColor=colors.white,
        ),
        "table_head": ParagraphStyle(
            "table_head",
            parent=base,
            fontName="CN-Bold",
            fontSize=8,
            leading=10,
            alignment=TA_CENTER,
            textColor=colors.white,
        ),
        "table": ParagraphStyle(
            "table",
            parent=base,
            fontSize=7.3,
            leading=9.8,
            textColor=colors.HexColor("#1f2937"),
        ),
        "table_bold": ParagraphStyle(
            "table_bold",
            parent=base,
            fontName="CN-Bold",
            fontSize=7.6,
            leading=10,
            textColor=colors.HexColor("#111827"),
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base,
            fontSize=8.5,
            leading=12,
            leftIndent=7,
            firstLineIndent=-7,
            textColor=colors.HexColor("#1f2937"),
        ),
    }


S = {}


def safe(text: object) -> str:
    return escape(str(text or "")).replace("\n", "<br/>")


def p(text: object, style_name: str = "base") -> Paragraph:
    return Paragraph(safe(text), S[style_name])


def bullet(items: list[str], style_name: str = "bullet") -> Paragraph:
    body = "<br/>".join(f"- {escape(str(item))}" for item in items if item)
    return Paragraph(body or "- 暂无补充说明。", S[style_name])


def icon(hexcore: dict, size_mm: float = 14) -> Image:
    image = Image(str(ICON_CACHE_DIR / f"{hexcore['id']}.png"), width=size_mm * mm, height=size_mm * mm)
    image.hAlign = "CENTER"
    return image


def category_label(hexcore: dict) -> str:
    return CAT_INFO.get(hexcore.get("category"), CAT_INFO["shop_control"])["label"]


def category_color(hexcore: dict):
    return CAT_INFO.get(hexcore.get("category"), CAT_INFO["shop_control"])["color"]


def mode_label(hexcore: dict) -> str:
    if hexcore.get("id") == "origin-sage":
        return "轮次自动"
    if hexcore.get("mode") == "passive":
        return "被动自动"
    if hexcore.get("maxUsesPerRound"):
        return "每轮一次"
    return "主动执行"


def use_label(hexcore: dict) -> str:
    if hexcore.get("id") == "origin-sage":
        return "轮次开始自动"
    if hexcore.get("mode") == "passive":
        return "自动触发"
    if hexcore.get("uses") == 1:
        return "每局1次"
    if hexcore.get("maxUsesPerRound"):
        return f"每轮最多{hexcore.get('maxUsesPerRound')}次"
    return "按规则次数"


def timing_label(hexcore: dict) -> str:
    return TIMING_BY_ID.get(hexcore["id"], "按规则窗口")


def target_label(hexcore: dict) -> str:
    if hexcore["id"] in TARGET_BY_ID:
        return TARGET_BY_ID[hexcore["id"]]
    target = hexcore.get("needsTarget")
    if target == "captain":
        return "目标队长"
    if target == "shopCard":
        return "当前商店卡"
    if target == "player":
        return "合法可选选手"
    if hexcore.get("mode") == "passive":
        return "无需选择目标"
    return "当前队长或当前状态"


def tags_label(hexcore: dict) -> str:
    tags = [TAG_LABEL.get(tag, tag) for tag in hexcore.get("tags", [])]
    return "、".join(tags) if tags else "无"


def first_tip(hexcore: dict) -> str:
    tips = TIPS_BY_ID.get(hexcore["id"])
    if tips:
        return tips[0]
    cat = hexcore.get("category")
    return {
        "shop_control": "先确认开店或刷新窗口，避免错过最佳使用时机。",
        "economy": "优先配合高费购买或关键轮次使用。",
        "disruption": "先确认目标仍有购买权、未满员且没有免疫。",
        "roster_replace": "先确认队伍空位、阵营和购买权消耗。",
        "order_response": "先确认当前顺位或响应窗口。",
    }.get(cat, "先确认当前轮次、队长、金币和购买权。")


def notes_for(hexcore: dict) -> list[str]:
    notes = []
    if hexcore.get("mode") == "passive":
        notes.append("被动海克斯由系统按触发条件自动判定，不需要裁判手动点击。")
    if hexcore.get("uses") == 1:
        notes.append("该海克斯每局通常只能成功使用1次，成功后会标记为已使用。")
    if hexcore.get("maxUsesPerRound"):
        notes.append("该海克斯按轮限制使用次数，同一轮重复触发会被拒绝。")
    if "direct_roster" in hexcore.get("tags", []):
        notes.append("直接入队仍受阵营、队长保护、容量和重复归属校验约束。")
    if "refund" in hexcore.get("tags", []):
        notes.append("涉及返还金币或购买权时，刷新次数是否返还以具体规则为准。")
    if hexcore.get("needsTarget"):
        notes.append("无合法目标时按钮应禁用或执行失败，并在日志中记录原因。")
    notes.extend(SPECIAL_JUDGE_NOTES.get(hexcore["id"], []))
    if not notes:
        notes.append("执行前确认当前轮次、当前队长、金币和购买权状态。")
    return list(dict.fromkeys(notes))


def judge_steps(hexcore: dict) -> list[str]:
    if hexcore.get("id") == "origin-sage":
        return [
            "确认持有者已获得该海克斯。",
            "轮次开始时由系统自动生成提到第一顺位效果。",
            "裁判不需要手动点击执行。",
            "检查顺位说明和事件日志是否记录自动提顺位结果。",
        ]
    if hexcore.get("mode") == "passive":
        return [
            "确认触发窗口已经到达。",
            "让系统自动结算，不手动改状态。",
            "检查事件日志是否记录触发结果。",
        ]
    steps = [
        "确认当前队长、当前轮次和海克斯持有者。",
        "检查该海克斯是否已使用或本轮已触发。",
        f"确认使用时机：{timing_label(hexcore)}。",
    ]
    if hexcore.get("needsTarget"):
        steps.append(f"选择并核验目标：{target_label(hexcore)}。")
    steps.append("执行后核对金币、购买权、刷新、顺位或入队状态是否符合规则。")
    steps.append("查看事件日志，确认成功或失败原因清楚。")
    return steps


def card_table(rows, col_widths, style=None):
    table = Table(rows, colWidths=col_widths, hAlign="LEFT")
    table.setStyle(style or TableStyle([]))
    return table


def section(title: str, accent=colors.HexColor("#0f766e")):
    return [
        Spacer(1, 5),
        Table(
            [[p(title, "h1")]],
            colWidths=["100%"],
            style=TableStyle(
                [
                    ("LINEBELOW", (0, 0), (-1, -1), 1.2, accent),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        ),
        Spacer(1, 6),
    ]


def make_cover(title: str, subtitle: str, doc_type: str, hexcores: list[dict], accent):
    chosen_ids = ["camp-scout", "discount-coupon", "heavenly-descent", "snow-cat", "wise-benevolence", "charged-cannon"]
    chosen = [next(item for item in hexcores if item["id"] == hex_id) for hex_id in chosen_ids]
    icon_row = [icon(item, 22) for item in chosen]
    story = [
        Spacer(1, 36 * mm),
        p(title, "cover_title"),
        Spacer(1, 5 * mm),
        p(subtitle, "cover_sub"),
        Spacer(1, 5 * mm),
        Table(
            [[p(doc_type, "white")]],
            colWidths=[70 * mm],
            hAlign="CENTER",
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), accent),
                    ("BOX", (0, 0), (-1, -1), 0.6, accent),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        ),
        Spacer(1, 15 * mm),
        Table(
            [icon_row],
            colWidths=[26 * mm] * len(icon_row),
            hAlign="CENTER",
            style=TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        ),
        Spacer(1, 12 * mm),
        p("基于当前系统代码中的27个海克斯和本地图标生成。适用于阵营锁定、金币商店、四轮抽卡模式。", "cover_sub"),
        PageBreak(),
    ]
    return story


def intro_pages(hexcores: list[dict], accent):
    counts = {
        "total": len(hexcores),
        "manual": len([item for item in hexcores if item.get("mode") != "passive"]),
        "passive": len([item for item in hexcores if item.get("mode") == "passive"]),
    }
    category_rows = []
    for cat in CAT_ORDER:
        items = [item for item in hexcores if item.get("category") == cat]
        category_rows.append(
            [
                p(CAT_INFO[cat]["label"], "table_bold"),
                p(CAT_INFO[cat]["brief"], "table"),
                p("、".join(item["name"] for item in items), "table"),
            ]
        )
    return [
        *section("先看这三件事", accent),
        bullet(
            [
                f"当前系统共有{counts['total']}个海克斯，其中{counts['manual']}个需要主动或目标执行，{counts['passive']}个为被动自动。",
                "所有入队、购买和目标选择都不能突破阵营限制。",
                "读海克斯时优先看使用时机、目标对象、是否消耗购买权。",
            ]
        ),
        Spacer(1, 6),
        p("当前规则底线", "h2"),
        bullet(
            [
                "当前模式为10队、阵营锁定、金币商店、四轮抽卡。",
                "不能让异阵营选手进入当前队伍。",
                "不能选择队长作为队员目标。",
                "被动海克斯由系统自动判断；主动海克斯由裁判按窗口执行。",
            ]
        ),
        Spacer(1, 8),
        p("五大分类", "h2"),
        Table(
            [[p("分类", "table_head"), p("作用", "table_head"), p("包含海克斯", "table_head")]] + category_rows,
            colWidths=[30 * mm, 54 * mm, 88 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        ),
        PageBreak(),
    ]


def build_doc(path: Path, story, title: str, pagesize=A4, accent=colors.HexColor("#0f766e")):
    doc = SimpleDocTemplate(
        str(path),
        pagesize=pagesize,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=18 * mm,
        bottomMargin=15 * mm,
        title=title,
        author="HEXCORE2.0",
    )

    def decorate(canvas, doc_obj):
        canvas.saveState()
        width, height = pagesize
        if doc_obj.page > 1:
            canvas.setStrokeColor(accent)
            canvas.setLineWidth(0.7)
            canvas.line(15 * mm, height - 12 * mm, width - 15 * mm, height - 12 * mm)
            canvas.setFillColor(colors.HexColor("#475569"))
            canvas.setFont("CN", 7.5)
            canvas.drawString(15 * mm, height - 9.5 * mm, title)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.setFont("CN", 7.5)
        canvas.drawCentredString(width / 2, 8 * mm, f"第 {doc_obj.page} 页")
        canvas.restoreState()

    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)


def quick_table_pdf(hexcores: list[dict]) -> Path:
    accent = colors.HexColor("#0f766e")
    path = OUTPUT_DIR / "A_HEXCORE2.0_当前海克斯速查表.pdf"
    story = make_cover("HEXCORE2.0 当前海克斯速查表", "A 版：给临场查阅使用，信息压缩但保留图标", "A - 速查表型 PDF", hexcores, accent)
    story.extend(intro_pages(hexcores, accent))
    story.extend(section("27个海克斯总表", accent))
    for cat in CAT_ORDER:
        items = [item for item in hexcores if item.get("category") == cat]
        story.append(p(CAT_INFO[cat]["label"], "h2"))
        rows = [[p("图标", "table_head"), p("海克斯", "table_head"), p("类型", "table_head"), p("时机", "table_head"), p("目标", "table_head"), p("效果速记", "table_head")]]
        for item in items:
            rows.append(
                [
                    icon(item, 10),
                    p(item["name"], "table_bold"),
                    p(mode_label(item), "table"),
                    p(timing_label(item), "table"),
                    p(target_label(item), "table"),
                    p(item.get("desc", ""), "table"),
                ]
            )
        table = Table(
            rows,
            colWidths=[14 * mm, 27 * mm, 20 * mm, 34 * mm, 40 * mm, 126 * mm],
            repeatRows=1,
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), category_color(items[0])),
                    ("GRID", (0, 0), (-1, -1), 0.28, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (0, 0), (0, -1), "CENTER"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        )
        story.append(table)
        story.append(Spacer(1, 6))
    story.append(PageBreak())
    story.extend(section("速查索引", accent))
    passive = [item["name"] for item in hexcores if item.get("mode") == "passive"]
    manual = [item["name"] for item in hexcores if item.get("mode") != "passive"]
    target_captain = [item["name"] for item in hexcores if item.get("needsTarget") == "captain"]
    target_card = [item["name"] for item in hexcores if item.get("needsTarget") == "shopCard"]
    target_player = [item["name"] for item in hexcores if item.get("needsTarget") == "player"]
    index_rows = [
        ["被动自动", "、".join(passive)],
        ["主动执行", "、".join(manual)],
        ["需要目标队长", "、".join(target_captain)],
        ["需要商店卡目标", "、".join(target_card)],
        ["需要选手目标", "、".join(target_player)],
        ["直接入队相关", "、".join(item["name"] for item in hexcores if "direct_roster" in item.get("tags", []))],
        ["金币相关", "、".join(item["name"] for item in hexcores if "gold" in item.get("tags", []) or item.get("category") == "economy")],
        ["顺位/响应相关", "、".join(item["name"] for item in hexcores if item.get("category") == "order_response")],
    ]
    story.append(
        Table(
            [[p("索引", "table_head"), p("海克斯", "table_head")]]
            + [[p(a, "table_bold"), p(b, "table")] for a, b in index_rows],
            colWidths=[36 * mm, 226 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("GRID", (0, 0), (-1, -1), 0.28, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        )
    )
    build_doc(path, story, path.stem, pagesize=landscape(A4), accent=accent)
    return path


def hex_guide_card(hexcore: dict):
    color = category_color(hexcore)
    header = Table(
        [
            [
                icon(hexcore, 18),
                [
                    p(hexcore["name"], "h2"),
                    p(f"{category_label(hexcore)} / {mode_label(hexcore)} / {use_label(hexcore)}", "small"),
                ],
            ]
        ],
        colWidths=[24 * mm, 144 * mm],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )
    info_rows = [
        [p("使用时机", "table_bold"), p(timing_label(hexcore), "table"), p("目标对象", "table_bold"), p(target_label(hexcore), "table")],
        [p("规则特性", "table_bold"), p(tags_label(hexcore), "table"), p("色阶", "table_bold"), p(TYPE_LABEL.get(hexcore.get("type"), hexcore.get("type")), "table")],
    ]
    info = Table(
        info_rows,
        colWidths=[19 * mm, 58 * mm, 19 * mm, 72 * mm],
        style=TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dbe4ee")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        ),
    )
    body = [
        [p("白话解释", "table_bold"), p(hexcore.get("desc", ""), "table")],
        [p("新手建议", "table_bold"), bullet(TIPS_BY_ID.get(hexcore["id"], [first_tip(hexcore)]), "table")],
        [p("注意事项", "table_bold"), bullet(notes_for(hexcore)[:4], "table")],
    ]
    body_table = Table(
        body,
        colWidths=[22 * mm, 146 * mm],
        style=TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dbe4ee")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        ),
    )
    return KeepTogether(
        [
            Table(
                [[header], [info], [body_table]],
                colWidths=[176 * mm],
                style=TableStyle(
                    [
                        ("BOX", (0, 0), (-1, -1), 0.8, color),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.8, color),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ("LEFTPADDING", (0, 0), (-1, -1), 7),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ]
                ),
            ),
            Spacer(1, 7),
        ]
    )


def guide_pdf(hexcores: list[dict]) -> Path:
    accent = colors.HexColor("#168aad")
    path = OUTPUT_DIR / "B_HEXCORE2.0_当前海克斯新手图鉴.pdf"
    story = make_cover("HEXCORE2.0 当前海克斯新手图鉴", "B 版：面向第一次接触海克斯机制的用户", "B - 图鉴手册型 PDF", hexcores, accent)
    story.extend(intro_pages(hexcores, accent))
    story.extend(section("怎么读一张海克斯卡", accent))
    story.append(
        Table(
            [
                [p("字段", "table_head"), p("意思", "table_head")],
                [p("图标和名称", "table_bold"), p("用于快速识别海克斯。PDF 中每个海克斯都附对应图标。", "table")],
                [p("分类", "table_bold"), p("决定它主要影响商店、金币、对手、入队还是顺位。", "table")],
                [p("主动/被动", "table_bold"), p("主动需要裁判按窗口执行；被动由系统自动判断。", "table")],
                [p("使用时机", "table_bold"), p("决定什么时候能用，错过窗口通常不能补用。", "table")],
                [p("目标对象", "table_bold"), p("说明要选队长、商店卡、选手，还是无需目标。", "table")],
                [p("注意事项", "table_bold"), p("重点看阵营、容量、购买权、金币、刷新次数和响应窗口。", "table")],
            ],
            colWidths=[34 * mm, 134 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            ),
        )
    )
    story.append(PageBreak())
    for cat in CAT_ORDER:
        items = [item for item in hexcores if item.get("category") == cat]
        story.extend(section(CAT_INFO[cat]["label"], CAT_INFO[cat]["color"]))
        story.append(p(CAT_INFO[cat]["brief"], "base"))
        story.append(Spacer(1, 6))
        for item in items:
            story.append(hex_guide_card(item))
        story.append(PageBreak())
    build_doc(path, story, path.stem, pagesize=A4, accent=accent)
    return path


def judge_card(hexcore: dict):
    color = category_color(hexcore)
    rows = [
        [
            icon(hexcore, 14),
            [
                p(hexcore["name"], "h3"),
                p(f"{category_label(hexcore)} / {mode_label(hexcore)} / {timing_label(hexcore)}", "tiny"),
            ],
        ],
        [p("规则摘要", "table_bold"), p(hexcore.get("desc", ""), "table")],
        [p("执行步骤", "table_bold"), bullet(judge_steps(hexcore), "table")],
        [p("拒绝或复核点", "table_bold"), bullet(notes_for(hexcore)[:6], "table")],
        [p("日志关键词", "table_bold"), p(f"{hexcore['name']}；{target_label(hexcore)}；成功/失败原因；金币、购买权、刷新或入队变化。", "table")],
    ]
    table = Table(
        rows,
        colWidths=[24 * mm, 144 * mm],
        style=TableStyle(
            [
                ("SPAN", (1, 0), (1, 0)),
                ("BOX", (0, 0), (-1, -1), 0.7, color),
                ("LINEBELOW", (0, 0), (-1, 0), 0.7, color),
                ("GRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#dbe4ee")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        ),
    )
    return KeepTogether([table, Spacer(1, 6)])


def judge_pdf(hexcores: list[dict]) -> Path:
    accent = colors.HexColor("#7c3aed")
    path = OUTPUT_DIR / "C_HEXCORE2.0_当前海克斯裁判执行手册.pdf"
    story = make_cover("HEXCORE2.0 当前海克斯裁判执行手册", "C 版：给裁判执行、复核、解释规则使用", "C - 裁判手册型 PDF", hexcores, accent)
    story.extend(intro_pages(hexcores, accent))
    story.extend(section("裁判执行总流程", accent))
    story.append(
        bullet(
            [
                "先确认当前队长、轮次、队伍容量、金币和购买权。",
                "再确认海克斯是否启用、是否已使用、是否处在正确时机。",
                "目标型海克斯必须先选择合法目标；无合法目标时不执行。",
                "任何直接入队都必须通过阵营、队长保护、容量和重复归属校验。",
                "执行成功或失败都要能在事件日志里解释清楚。",
            ]
        )
    )
    story.append(Spacer(1, 6))
    story.append(p("通用失败原因", "h2"))
    story.append(
        bullet(
            [
                "时机错误：例如开店后才尝试使用开店前海克斯。",
                "目标非法：目标已满员、已行动窗口失效、无购买权、被免疫或不符合阵营限制。",
                "资源不足：金币不足、刷新次数不足、购买权已消耗。",
                "状态冲突：海克斯已使用、本轮次数已用、目标已离开卡池。",
                "入队校验失败：异阵营、队长保护、重复归属或队伍容量超限。",
            ]
        )
    )
    story.append(PageBreak())
    for cat in CAT_ORDER:
        items = [item for item in hexcores if item.get("category") == cat]
        story.extend(section(CAT_INFO[cat]["label"], CAT_INFO[cat]["color"]))
        story.append(p(CAT_INFO[cat]["brief"], "base"))
        story.append(Spacer(1, 6))
        for item in items:
            story.append(judge_card(item))
        story.append(PageBreak())
    story.extend(section("裁判复盘检查清单", accent))
    story.append(
        bullet(
            [
                "每队最多持有1个海克斯；候选不应出现全局已占用或已禁用海克斯。",
                "每次购买后核对金币扣减、折扣、返还、购买权和刷新次数。",
                "每次入队后核对阵营、队伍容量、重复归属和队长保护。",
                "每轮开始核对被动海克斯、轮初收入、顺位调整和延迟效果。",
                "最终补位只从同阵营、非队长、未入队、未禁用选手中随机。",
            ]
        )
    )
    build_doc(path, story, path.stem, pagesize=A4, accent=accent)
    return path


def render_previews(paths: list[Path]) -> None:
    import fitz

    for pdf_path in paths:
        doc = fitz.open(str(pdf_path))
        preview_paths = []
        max_pages = min(3, doc.page_count)
        for index in range(max_pages):
            page = doc.load_page(index)
            pix = page.get_pixmap(matrix=fitz.Matrix(0.65, 0.65), alpha=False)
            out = PREVIEW_DIR / f"{pdf_path.stem}_p{index + 1}.png"
            pix.save(str(out))
            preview_paths.append(out)
        # 生成前三页拼图，便于快速目检。
        images = [PILImage.open(path).convert("RGB") for path in preview_paths]
        width = max(image.width for image in images)
        height = sum(image.height for image in images) + 12 * (len(images) - 1)
        sheet = PILImage.new("RGB", (width, height), "white")
        y = 0
        for image in images:
            sheet.paste(image, ((width - image.width) // 2, y))
            y += image.height + 12
        sheet.save(PREVIEW_DIR / f"{pdf_path.stem}_preview.png")
        doc.close()


def validate_pdf_text(paths: list[Path]) -> None:
    from pypdf import PdfReader

    for pdf_path in paths:
        reader = PdfReader(str(pdf_path))
        if len(reader.pages) < 3:
            raise RuntimeError(f"{pdf_path.name} 页数异常：{len(reader.pages)}")
        first_text = (reader.pages[0].extract_text() or "") + (reader.pages[min(1, len(reader.pages) - 1)].extract_text() or "")
        if "HEXCORE2.0" not in first_text:
            raise RuntimeError(f"{pdf_path.name} 未提取到标题文本")


def main() -> None:
    ensure_dirs()
    register_fonts()
    global S
    S = styles()
    hexcores = load_hexcores()
    validate_icons(hexcores)
    build_icon_cache(hexcores)
    paths = [
        quick_table_pdf(hexcores),
        guide_pdf(hexcores),
        judge_pdf(hexcores),
    ]
    validate_pdf_text(paths)
    render_previews(paths)
    summary = {
        "pdfs": [str(path) for path in paths],
        "previews": [str(PREVIEW_DIR / f"{path.stem}_preview.png") for path in paths],
        "hexcore_count": len(hexcores),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
