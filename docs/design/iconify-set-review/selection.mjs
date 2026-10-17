// Every UI role in each candidate stays inside one Iconify family/style.
export const candidates={
  a:{title:'A · Solar Linear',short:'柔和、舒展的细线',prefix:'solar',suffix:'-linear',note:'Solar Linear：圆润外框与舒展曲线，保留原生 1.5 描边。界面中的 72 个图标用途统一使用 Linear；小尺寸顶栏请重点看清晰度。',url:'https://icon-sets.iconify.design/solar/'},
  b:{title:'B · Fluent Regular',short:'克制的桌面原生感',prefix:'fluent',suffix:'-24-regular',note:'Fluent UI System Icons：全部选择 24 Regular，同一设计体系、同一尺寸母版。轮廓柔和且较紧凑，保留微软原始路径。',url:'https://icon-sets.iconify.design/fluent/'},
  c:{title:'C · IconPark Outline',short:'更饱满、更鲜明的轮廓',prefix:'icon-park-outline',suffix:'',note:'IconPark Outline：统一使用线性轮廓，保留原生 48 网格与 4 描边，缩到 24 px 相当于 2 px。圆端点更明显，小尺寸视觉重量也更高。',url:'https://icon-sets.iconify.design/icon-park-outline/'},
}

// key | Solar Linear base | Fluent 24 Regular base | IconPark Outline
export const rows=`
sessions | chat-round | chat | message
labels | tag | tag | tag-one
sources | database | database | data
skills | lightbulb-minimalistic | lightbulb | light
plugins | plug-circle | puzzle-piece | puzzle
projects | folder | folder | folder-close
pages | panel-top | window | browser
automations | repeat | arrow-repeat-all | cycle
settings | tuning-2 | options | setting-config
new | pen-new-square | compose | writing-fluently
sidebar | panel-left | panel-left | layout-two
search | rounded-magnifier | search | search
filter | filter | filter | filter
more | menu-dots | more-horizontal | more
add | add | add | add
close | close | dismiss | close-small
left | alt-arrow-left | chevron-left | left
right | alt-arrow-right | chevron-right | right
down | alt-arrow-down | chevron-down | down
copy | copy | copy | copy
edit | pen | edit | edit
delete | trash-bin-minimalistic | delete | delete
external | square-arrow-right-up | open | share
download | download-minimalistic | arrow-download | download
refresh | refresh | arrow-clockwise | refresh
pin | pin | pin | pushpin
archive | archive | archive | inbox
attach | paperclip-rounded | attach | paperclip
send | arrow-up | arrow-up | arrow-up
message | chat-round-dots | comment | comment
ai | stars-minimalistic | sparkle | magic
bot | bot | bot | robot
terminal | file-terminal | code-block | terminal
code | code | code | code
file | file | document | file-text
document | document-text | document-text | file-text-one
folder | folder-open | folder-open | folder-open
image | gallery | image | pic
table | table | table | table
json | brackets | braces | code-brackets
branch | git-branch | branch | branch
diff | file-pen | document-landscape-split | file-conversion
globe | global | globe | earth
maximize | maximize | arrow-maximize | full-screen
appearance | palette-round | color | color-card
input | keyboard | keyboard | keyboard
workspace | buildings-2 | building-multiple | building-two
permissions | shield-check | shield-checkmark | permissions
server | server | server | server
account | user-circle | person-circle | user
general | settings-minimalistic | toggle-right | switch
key | key-minimalistic | key | key
eye | eye | eye | preview-open
sun | sun | weather-sunny | sun-one
moon | moon | weather-moon | moon
monitor | monitor | desktop | monitor
clock | clock-circle | clock | time
success | check-circle | checkmark-circle | check-one
warning | danger-triangle | warning | attention
error | close-circle | dismiss-circle | close-one
info | info-circle | info | info
check | check | checkmark | check
loading | loader | arrow-clockwise-dashes | loading
switchSessions | chat-round | chat | message
kanban | kanban | board-split | view-grid-card
calendar | calendar-date | calendar-month | calendar
gantt | align-left | gantt-chart | timeline
filesPanel | folder-tree | text-bullet-list-tree | tree-list
trajectory | graph-new | pulse | chart-line
help | question-circle | question-circle | help
unpin | pin | pin-off | pushpin
restore | minimize | arrow-minimize | off-screen
`.trim().split('\n').map(line=>line.split('|').map(x=>x.trim()))

export const notes={
  sessions:'统一用对话气泡，导航与顶栏「对话」使用同一个字形。',
  labels:'保留标签语义与必要切角；主要比较切角、孔位和轮廓重量。',
  sources:'采用纯数据库轮廓，去掉当前 DatabaseZap 的闪电。',
  skills:'Solar、Fluent 用灯泡；IconPark 用灵感光芒。都减少闪电锐角，光芒的语义更依赖文字。',
  plugins:'Solar 用圆框插头；Fluent 与 IconPark 用拼图，均取自各自整套。',
  projects:'以简洁文件夹代表项目；文件树入口另用层级或目录图形。',
  pages:'三套均使用窗口轮廓，与浏览器入口的地球作区分。',
  automations:'使用循环表达自动运行；这是语义调整，事件触发仍需文字说明。',
  settings:'统一选择滑杆，避开齿轮尖齿，同时保留各套原生风格。',
}
