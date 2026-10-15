import * as React from 'react'
import { createRoot } from 'react-dom/client'
function Fixture() {
  const [text,setText] = React.useState(''), [clicks,setClicks] = React.useState(0), [select,setSelect] = React.useState('first')
  const [open,setOpen] = React.useState(false), [custom,setCustom] = React.useState('Red')
  return <main>
    <label>Controlled text<input id="text" aria-label="Controlled text" value={text} onChange={event => setText(event.target.value)} /></label><output id="text-state">{text}</output>
    <button onClick={() => setClicks(value => value+1)}>Increment</button><output id="click-state">{clicks}</output>
    <select aria-label="Native choices" value={select} onChange={event => setSelect(event.target.value)}><option value="first">First</option><option value="second">Second</option></select><output id="select-state">{select}</output>
    <button role="combobox" aria-label="Custom choices" aria-expanded={open} onClick={() => setOpen(value => !value)}>{custom}</button>
    {open && <div role="listbox">{['Red','Blue'].map(item => <div role="option" key={item} onClick={() => {setCustom(item);setOpen(false)}}>{item}</div>)}</div>}
    <output id="custom-state">{custom}</output>
    <input id="password" aria-label="Password" type="password" />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
