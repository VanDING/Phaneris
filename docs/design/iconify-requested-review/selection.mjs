export const candidates={
  a:{title:'A · Line MD',short:'线条明确 · 原生描线动画',prefix:'line-md',suffix:'',url:'https://icon-sets.iconify.design/line-md/',note:'Line MD：保留原生轮廓和描线动画。默认显示完成形态，可开启动态并重播；近似映射已标明，思考中统一使用 Blocks Wave。'},
  b:{title:'B · Coolicons',short:'圆端点 · 完整工具感',prefix:'ci',suffix:'',url:'https://icon-sets.iconify.design/ci/',note:'Coolicons：保留原生 24 网格、2 描边和圆端点；终端、数据库、拼图等有直接对应，思考中统一使用 Blocks Wave。'},
  c:{title:'C · Mono Icons',short:'简洁紧凑 · 路径轮廓',prefix:'mi',suffix:'',url:'https://icon-sets.iconify.design/mi/',note:'Mono Icons：保留原生 24 网格与填充路径构成的轮廓；专用业务图形较少，部分使用同套近似图形。思考中统一使用 Blocks Wave。'},
}
export const rows=`
sessions | chat-round | chat-circle | message
labels | hash | tag | tag
sources | cloud | data | database
skills | lightbulb | bulb | book
plugins | link | puzzle | layers
projects | folder | folder | folder
pages | text-box | window | window
automations | backup-restore | repeat | repeat
settings | cog | slider-03 | settings
new | edit | note-edit | edit
sidebar | menu-fold-left | window-sidebar | layout
search | search | search-magnifying-glass | search
filter | filter | filter | filter
more | menu | more-horizontal | options-horizontal
add | plus | add-plus | add
close | close | close-md | close
left | chevron-left | chevron-left | chevron-left
right | chevron-right | chevron-right | chevron-right
down | chevron-down | chevron-down | chevron-down
copy | text-box-multiple | copy | copy
edit | pencil | edit-pencil-01 | pen
delete | trash | trash-empty | delete
external | external-link-rounded | external-link | external-link
download | download | download | download
refresh | backup-restore | arrows-reload-01 | refresh
pin | map-marker | map-pin | pin
archive | folder-arrow-down | archive | archive
attach | link | paperclip-attechment-tilt | attachment
send | arrow-up | arrow-up-md | arrow-up
message | chat-round-dots | message-writing | comment
ai | star | star | favorite
bot | computer | user-circle | user
terminal | document-code | window-terminal | window
code | document-code | code | document
file | file | file-blank | document-empty
document | file-document | file-document | document
folder | folder | folder-open | folder
image | image | image-01 | image
table | grid-3 | table | table
json | document-code | code | document
branch | fork-left | share-android | share
diff | file-document-plus | file-edit | document-remove
globe | compass | globe | compass
maximize | arrows-diagonal | expand | expand
appearance | paint-drop | swatches-palette | drop
input | text-box | keyboard | text
workspace | briefcase | building-02 | home
permissions | security | shield-check | lock
server | cloud | desktop-tower | database
account | account | user-circle | user
general | switch | swicht-right | switch
key | security | lock | lock
eye | watch | show | eye
sun | sunny | sun | sun
moon | moon | moon | moon
monitor | monitor | monitor | computer
clock | backup-restore | clock | clock
success | confirm-circle | circle-check | circle-check
warning | alert | triangle-warning | warning
error | close-circle | close-circle | circle-error
info | question-circle | info-circle | circle-information
check | confirm | check | check
loading | loading-loop | loading | refresh
switchSessions | chat-round | chat-circle | message
kanban | list-3 | columns | board
calendar | calendar | calendar-days | calendar
gantt | list | chart-bar-horizontal-01 | three-rows
filesPanel | folder-network | folders | folder
trajectory | document-report | chart-line | bar-chart-alt
help | question-circle | help-circle | circle-help
unpin | map-marker | map-pin | pin
restore | arrow-close-down | shrink | minimize
`.trim().split('\n').map(line=>line.split('|').map(value=>value.trim()))

export const notes={
  sessions:'三套使用对话气泡；导航与顶栏对话共用同一图形。',
  labels:'Line MD 用井号表达标签；Coolicons 和 Mono 使用标签轮廓。',
  sources:'Coolicons、Mono 有数据库；Line MD 暂用云端数据源，属于近似。',
  skills:'Line MD、Coolicons 用灯泡；Mono 没有灯泡，用知识书本作近似。',
  plugins:'Coolicons 使用拼图；Line MD 用连接、Mono 用图层表示扩展，均为近似。',
  projects:'同套文件夹，保留每套原生比例。',
  pages:'Line MD 用文本框表示页面；另两套使用窗口。',
  automations:'Coolicons、Mono 用循环；Line MD 用恢复／历史弧线近似。',
  settings:'Line MD 与 Mono 用各自设置轮廓；Coolicons 用滑杆。',
}

export const approximate={
  a:{sources:'缺少数据库，借用云端轮廓',plugins:'缺少拼图／插头，借用连接',pages:'以文本框代表页面',automations:'以恢复／历史弧线代表自动运行',more:'缺少横向省略号，借用菜单',copy:'借用多文档',refresh:'恢复／历史弧线近似',pin:'位置标记，缺少图钉',archive:'文件夹下载近似归档',attach:'连接代替回形针',bot:'电脑代替智能体',terminal:'代码文档代替终端窗口',code:'代码文档代替独立代码符号',table:'网格近似表格',json:'缺少花括号，借用代码文档',branch:'道路分叉近似版本分支',diff:'新增文档近似变更',globe:'指南针代替地球',input:'文本框代替键盘',server:'云端轮廓代替服务器',key:'安全盾代替钥匙',clock:'历史图形代替独立时钟',info:'问号代替信息标记',kanban:'列表近似看板',gantt:'水平列表近似甘特图',trajectory:'报告文档近似轨迹',unpin:'复用位置标记，通过状态区分',restore:'向内箭头近似还原'},
  b:{pin:'位置标记，缺少图钉',bot:'用户圆框代替智能体',json:'代码符号代替花括号',branch:'分享分叉近似版本分支',diff:'编辑文档近似变更',server:'主机塔代替服务器',key:'锁代替钥匙',gantt:'水平条形图近似甘特图',unpin:'复用位置标记，通过状态区分'},
  c:{skills:'书本近似技能／知识',plugins:'图层近似扩展',sidebar:'布局近似侧栏',bot:'用户代替智能体',terminal:'窗口近似终端',code:'文档代替代码符号',json:'文档代替花括号',branch:'分享分叉近似版本分支',diff:'删减文档近似变更',globe:'指南针代替地球',appearance:'色滴近似外观',input:'文字代替键盘',workspace:'家代表工作区',permissions:'锁代替权限盾',server:'数据库代替服务器',key:'锁代替钥匙',loading:'刷新轮廓近似通用加载',general:'双向切换代替通用偏好',gantt:'横向三行近似甘特图',filesPanel:'通用文件夹代替文件树',trajectory:'条形图近似运行轨迹',unpin:'复用图钉，通过状态区分'},
}
