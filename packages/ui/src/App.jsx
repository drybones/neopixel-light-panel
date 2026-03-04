import React, { Component, useState, useEffect, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import './App.css';

var baseUrl = import.meta.env.REACT_APP_LIGHTPANEL_API_SERVER || window.location.origin;
var wsUrl = import.meta.env.REACT_APP_LIGHTPANEL_WS_SERVER || baseUrl.replace(/^http(s?)/, 'ws$1').replace(/:\d+$/, ':3001');

const defaultWavelet = {
    "id": null,
    "color": "#ffffff",
    "freq": 0.2,
    "lambda": 0.5,
    "delta": 0.0,
    "x": 0.0,
    "y": 0,
    "min": 0.1,
    "max": 0.7,
    "clip": true
};

const defaultPreset = {
    "id": null,
    "name": "New Preset",
    "type": "wavelet",
    "wavelets": [],
};

// TODO These should live somewhere else
const sliderScalingParam = 6.7975;
function sliderToMinMax(sliderValue) {
  return Math.tan(sliderValue / sliderScalingParam);
}
function minMaxToSlider(minMaxValue) {
  return sliderScalingParam * Math.atan(minMaxValue);
}

function App() {
  return (
    <div className="App container">
      <h1 className="my-3">Lightpanel</h1>
      <PresetConfig/>
    </div>
  );
}

function putData(url, data) {
  return fetch(url, {
    body: data !== undefined ? JSON.stringify(data) : undefined,
    cache: 'no-cache',
    headers: {
      'user-agent': 'Mozilla/4.0 MDN Example',
      'content-type': 'application/json'
    },
    method: 'PUT',
    mode: 'cors',
    redirect: 'follow',
    referrer: 'no-referrer',
  });
}

function updateServerConfig(id, config) {
  return putData(baseUrl + '/api/wave_config/' + id, config);
}

function PresetConfig() {
  const [presets, setPresets] = useState([]);
  const [currentPresetId, setCurrentPresetId] = useState(null);
  const [presetConfig, setPresetConfig] = useState(null);
  const [globalBrightness, setGlobalBrightness] = useState(1.0);
  const [isVirtual, setIsVirtual] = useState(null);
  const miniCanvasRef = useRef(null);
  const importInputRef = useRef(null);

  function doFetchPresetConfig(id, presetsList) {
    const preset = presetsList.find(o => o.id === id);
    if (!preset || preset.type === 'fixed') {
      setPresetConfig(null);
    } else {
      fetch(baseUrl + '/api/wave_config/' + preset.id)
        .then(r => r.json())
        .then(setPresetConfig);
    }
  }

  useEffect(() => {
    // Fetch the current preset only after we've got the list
    fetch(baseUrl + '/api/all_presets/')
      .then(r => r.json())
      .then(presetList => {
        setPresets(presetList);
        return fetch(baseUrl + '/api/current_preset_id/')
          .then(r => r.text())
          .then(id => {
            setCurrentPresetId(id);
            doFetchPresetConfig(id, presetList);
          });
      });

    // Can fetch the brightness and virtual mode flag in parallel
    fetch(baseUrl + '/api/brightness/')
      .then(r => r.text())
      .then(setGlobalBrightness);

    fetch(baseUrl + '/api/virtual')
      .then(r => r.json())
      .then(d => setIsVirtual(d.virtual))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePresetListClick(id) {
    setCurrentPresetId(id);
    putData(baseUrl + '/api/current_preset_id/' + id);
    doFetchPresetConfig(id, presets);
  }

  function handleNewPresetClick() {
    const newPreset = { ...defaultPreset, id: crypto.randomUUID().split('-')[0], wavelets: [] };
    updateServerConfig(newPreset.id, newPreset);
    putData(baseUrl + '/api/current_preset_id/' + newPreset.id);
    setPresets(prev => [...prev, { id: newPreset.id, name: newPreset.name }]);
    setCurrentPresetId(newPreset.id);
    setPresetConfig(newPreset);
  }

  function handleDeletePresetClick(id) {
    setPresets(prev => prev.filter(o => o.id !== id));
    if (currentPresetId === id) {
      setCurrentPresetId(presets[0].id); // The first is fixed, and "Off"
      setPresetConfig(null);
    }
    fetch(baseUrl + '/api/wave_config/' + id, {
      headers: { 'content-type': 'application/json' },
      method: 'DELETE',
      mode: 'cors',
    });
  }

  function handleNewWaveletClick() {
    const newWavelet = { ...defaultWavelet, id: crypto.randomUUID().split('-')[0] };
    const newPresetConfig = { ...presetConfig, wavelets: [...presetConfig.wavelets, newWavelet] };
    setPresetConfig(newPresetConfig);
    updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  function handleDeleteWaveletClick(id) {
    const newPresetConfig = { ...presetConfig, wavelets: presetConfig.wavelets.filter(w => w.id !== id) };
    setPresetConfig(newPresetConfig);
    updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  function handleSoloWaveletClick(id) {
    const newPresetConfig = {
      ...presetConfig,
      wavelets: presetConfig.wavelets.map(w => ({ ...w, solo: w.id === id ? !w.solo : false })),
    };
    setPresetConfig(newPresetConfig);
    updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  function handleWaveletChange(waveletConfigId, event) {
    const { name, type, checked, value } = event.target;

    // TODO Use a proper numeric input that handles this...
    const numericParams = new Set(['freq', 'lambda', 'delta', 'x', 'y', 'min', 'max']);
    let parsedValue;
    if (type === 'checkbox') {
      parsedValue = checked;
    } else if (numericParams.has(name)) {
      parsedValue = (name === 'min' || name === 'max') ? sliderToMinMax(Number(value)) : Number(value);
    } else {
      parsedValue = value;
    }

    const newWavelets = presetConfig.wavelets.map(w => {
      if (w.id !== waveletConfigId) return w;
      const updated = { ...w, [name]: parsedValue };
      // Keep the brightness sliders from inverting
      if (name === 'min') updated.max = Math.max(updated.min, updated.max);
      if (name === 'max') updated.min = Math.min(updated.min, updated.max);
      return updated;
    });

    const newPresetConfig = { ...presetConfig, wavelets: newWavelets };
    setPresetConfig(newPresetConfig);
    updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  function handlePresetNameChange(event) {
    const name = event.target.value;
    const newPresetConfig = { ...presetConfig, name };
    setPresetConfig(newPresetConfig);
    setPresets(prev => prev.map(o => o.id === currentPresetId ? { ...o, name } : o));
    updateServerConfig(currentPresetId, newPresetConfig);
  }

  function handleGlobalBrightnessChange(event) {
    const value = sliderToMinMax(Number(event.target.value));
    setGlobalBrightness(value);
    putData(baseUrl + '/api/brightness/' + value);
  }

  function handleExportClick() {
    fetch(baseUrl + '/api/all_wave_config/')
      .then(r => r.json())
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `lightpanel-presets-${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  function handleImportClick() {
    importInputRef.current.click();
  }

  function handleImportFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const reader = new FileReader();
    reader.onload = function(e) {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (_) {
        alert('Import failed: file is not valid JSON.');
        return;
      }
      if (!Array.isArray(parsed)) {
        alert('Import failed: file must contain a JSON array of presets.');
        return;
      }
      fetch(baseUrl + '/api/all_wave_config/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      }).then(r => {
        if (!r.ok) { alert('Import failed: server rejected the file.'); return; }
        return fetch(baseUrl + '/api/all_presets/')
          .then(r => r.json())
          .then(presetList => {
            setPresets(presetList);
            return fetch(baseUrl + '/api/current_preset_id/')
              .then(r => r.text())
              .then(id => {
                setCurrentPresetId(id);
                doFetchPresetConfig(id, presetList);
              });
          });
      });
    };
    reader.readAsText(file);
  }

  return (
    <div className="row">
      <div className="col-md-3">
        <BrightnessControl globalBrightness={globalBrightness} onGlobalBrightnessChange={handleGlobalBrightnessChange} />
        <PresetList
          presets={presets}
          currentPresetId={currentPresetId}
          onClick={handlePresetListClick}
          onNewPresetClick={handleNewPresetClick}
          onExportClick={handleExportClick}
          onImportClick={handleImportClick}
          onImportFileChange={handleImportFileChange}
          importInputRef={importInputRef}
        />
      </div>
      <div className="col-md">
        <PresetItem
          presetConfig={presetConfig}
          miniCanvasRef={miniCanvasRef}
          isVirtual={isVirtual}
          ledPanel={<LEDPanel miniCanvasRef={miniCanvasRef} showFullPanel={isVirtual !== false} />}
          onPresetNameChange={handlePresetNameChange}
          onDeletePresetClick={handleDeletePresetClick}
          onWaveletChange={handleWaveletChange}
          onNewWaveletClick={handleNewWaveletClick}
          onDeleteWaveletClick={handleDeleteWaveletClick}
          onSoloWaveletClick={handleSoloWaveletClick}
        />
      </div>
    </div>
  );
}

function BrightnessControl(props)
{
  return (
    <div className="form-group">
    <label className="small">Brightness</label>
    <div className="form-row">
      <div className="col-md">
        <input className="form-control form-control-sm" type="range" min="0" max="10" step="0.01" value={minMaxToSlider(props.globalBrightness)} name="min" onChange={props.onGlobalBrightnessChange}/>
      </div>
      <div className="col-md-1">
        <span className="form-text small">{Number(props.globalBrightness).toFixed(2)}</span>
      </div>
    </div>
    </div>
  );
}

function PresetList(props)
{
  let presetItems = props.presets.map((preset) =>
    <li
      className={(props.currentPresetId === preset.id) ? "list-group-item active" : ("list-group-item" + ((preset.type === 'fixed') ? " list-group-item-secondary" : ""))}
      key={preset.id}
      preset-id={preset.id}
      active={(props.currentPresetId === preset.id)}
      onClick={() => props.onClick(preset.id)}
    >
      {preset.name}
    </li>
  );
  return (
    <div className="PresetList">
      <ul className="list-group">
        {presetItems}
      </ul>
      <button className="btn btn-secondary btn-block mt-2" onClick={props.onNewPresetClick}>+ Add new preset</button>
      <button className="btn btn-outline-secondary btn-block mt-1" onClick={props.onExportClick}>Export presets</button>
      <button className="btn btn-outline-secondary btn-block mt-1 mb-3" onClick={props.onImportClick}>Import presets</button>
      <input
        ref={props.importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={props.onImportFileChange}
      />
    </div>
  );
}

function PresetItem(props) {
  const [isMini, setIsMini] = useState(false);
  const showMini = isMini || props.isVirtual === false;
  const headerRef = useRef(null);
  const topSentinelRef = useRef(null);
  const fullPanelRef = useRef(null);

  useEffect(() => {
    setIsMini(false);
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const headerHeight = headerRef.current ? headerRef.current.offsetHeight : 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const panelHasHeight = fullPanelRef.current && fullPanelRef.current.offsetHeight > 0;
        setIsMini(!entry.isIntersecting && entry.boundingClientRect.top < headerHeight && panelHasHeight);
      },
      { threshold: 0, rootMargin: `-${headerHeight}px 0px 0px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [props.presetConfig ? props.presetConfig.id : null]);

  if (props.presetConfig) {
    let waveletList = props.presetConfig.wavelets.map((waveletConfig) =>
      <WaveletItem
        waveletConfig={waveletConfig}
        key={waveletConfig.id}
        onWaveletChange={(e) => props.onWaveletChange(waveletConfig.id, e)}
        onDeleteWaveletClick={() => props.onDeleteWaveletClick(waveletConfig.id)}
        onSoloWaveletClick={() => props.onSoloWaveletClick(waveletConfig.id)}
      />
    );
    return (
      <div id="PresetItem">

        {/* ── STICKY HEADER ── */}
        <div ref={headerRef} className={`preset-item-header${showMini ? ' preset-item-header--mini' : ''}`}>
          <div className="preset-item-mini-canvas-wrap">
            <canvas
              ref={props.miniCanvasRef}
              width={300}
              height={80}
              className="preset-item-mini-canvas"
            />
          </div>
          <div className="form-group preset-item-name-group">
            <div className="form-row">
              <div className="col-md">
                <input className="form-control form-control-lg" placeholder="Preset Name"
                  type="text" name="name" value={props.presetConfig.name}
                  onChange={props.onPresetNameChange} />
              </div>
              <div className="col-md-auto">
                <span className="text-muted">Preset ID<br/>{props.presetConfig.id}</span>
              </div>
              <div className="col-md-auto">
                <button className="btn btn-danger btn-lg"
                  onClick={() => props.onDeletePresetClick(props.presetConfig.id)}>Delete</button>
              </div>
            </div>
          </div>
        </div>

        {/* ── ZERO-HEIGHT SENTINEL: fires as soon as panel top hides behind header ── */}
        <div ref={topSentinelRef} style={{ height: 0 }} />

        {/* ── FULL LED PANEL ── */}
        <div ref={fullPanelRef} className="preset-item-full-panel-sentinel">
          {props.ledPanel}
        </div>

        {waveletList}
        <button className="btn btn-secondary" onClick={props.onNewWaveletClick}>+ Add new wavelet</button>
      </div>
    );
  } else {
    return (
      <div>
        <div className="alert alert-info">No interactive preset selected. Choose one from the list, or add a new one.</div>
        {props.ledPanel}
      </div>
    );
  }
}

class WaveletItem extends Component
{
  // TODO Extract out the color swatch and picker into a component

  constructor(props) {
    super(props);
    this.state = {
      displayColorPicker: false,
    }
  }

  handleClick = () => {
    this.setState({displayColorPicker: !this.state.displayColorPicker});
  }
  handleClose = () => {
    this.setState({ displayColorPicker: false });
  };

  render() {
    return (
      <div className="border rounded p-3 mb-3">

        <div className="form-row">
          <div className="form-group col-md">
            <label className="small">Frequency</label>
            <input className="form-control form-control-sm" type="number" step="0.1" value={this.props.waveletConfig.freq} name="freq" onChange={this.props.onWaveletChange}/>
          </div>
          <div className="form-group col-md">
            <label className="small">Wavelength</label>
            <input className="form-control form-control-sm" type="number" step="0.1" value={this.props.waveletConfig.lambda} name="lambda" onChange={this.props.onWaveletChange}/>
          </div>
          <div className="form-group col-md">
            <label className="small">Phase</label>
            <input className="form-control form-control-sm" type="number" step="0.1" value={this.props.waveletConfig.delta} name="delta" onChange={this.props.onWaveletChange} />
          </div>
        </div>

        <div className="form-group">
          <label className="small">Colour</label>
          <div className="form-row">
            <div className="col">
              <button
                className="btn btn-sm border form-control form-control-sm"
                style={{ background: this.props.waveletConfig.color }}
                onClick={this.handleClick}
              >&nbsp;</button>
              {this.state.displayColorPicker &&
                <div style={{ position: 'absolute', zIndex: 25 }}>
                  <div
                    style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0 }}
                    onClick={this.handleClose}
                  />
                  <HexColorPicker
                    color={this.props.waveletConfig.color}
                    onChange={(hex) => this.props.onWaveletChange({ target: { name: 'color', value: hex, type: 'colorpicker' } })}
                  />
                </div>
              }
            </div>
            <div className="col">
              <input className="form-control form-control-sm" type="text" size="3" value={this.props.waveletConfig.color} name="color" onChange={this.props.onWaveletChange}/>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="small">Brightness</label>
          <div className="form-row">
            <div className="col-md-1">
              <span className="form-text small">{Number(this.props.waveletConfig.min).toFixed(2)}</span>
            </div>
            <div className="col-md">
              <input className="form-control form-control-sm" type="range" min="-10" max="10" step="0.01" value={minMaxToSlider(this.props.waveletConfig.min)} name="min" onChange={this.props.onWaveletChange}/>
            </div>
            <div className="col-md">
              <input className="form-control form-control-sm" type="range" min="-10" max="10" step="0.01" value={minMaxToSlider(this.props.waveletConfig.max)} name="max" onChange={this.props.onWaveletChange}/>
            </div>
            <div className="col-md-1">
              <span className="form-text small">{Number(this.props.waveletConfig.max).toFixed(2)}</span>
            </div>
          </div>
          <div className="form-row d-none">
            <div className="col-md">
              <input className="form-control form-control-sm" type="checkbox" value={this.props.waveletConfig.clip} name="clip" onChange={this.props.onWaveletChange}/>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="small">Position</label>
          <div className="form-row">
            <div className="col-md">
              <input className="form-control form-control-sm" type="number" step="0.1" value={this.props.waveletConfig.x} name="x" onChange={this.props.onWaveletChange}/>
            </div>
            <div className="col-md">
              <input className="form-control form-control-sm" type="number" step="0.1" value={this.props.waveletConfig.y} name="y" onChange={this.props.onWaveletChange}/>
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="col">
            <button className={(this.props.waveletConfig.solo ? "active " : "") + "btn btn-outline-primary btn-sm"} onClick={this.props.onSoloWaveletClick}>Solo</button>
          </div>
          <div className="col-auto">
            <span className="text-muted mr-3 small">Wavelet ID {this.props.waveletConfig.id}</span>
            <button className="btn btn-danger btn-sm" onClick={this.props.onDeleteWaveletClick}>Delete</button>
          </div>
        </div>

      </div>
    );
  }
}

class LEDPanel extends Component {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.state = { connected: false };
    this.ws = null;
  }

  componentDidMount() {
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => this.setState({ connected: true });
    this.ws.onclose = () => this.setState({ connected: false });
    this.ws.onerror = () => this.setState({ connected: false });
    this.ws.onmessage = (e) => {
      this.drawPixels(JSON.parse(e.data));
    };
  }

  componentWillUnmount() {
    if (this.ws) this.ws.close();
  }

  drawToCanvas(canvas, pixels) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const COLS = 30, ROWS = 8;
    const W = canvas.width / COLS;
    const H = canvas.height / ROWS;
    const radius = Math.min(W, H) / 2 * 0.75;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    pixels.forEach(([r, g, b], i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(col * W + W / 2, row * H + H / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawPixels(pixels) {
    this.drawToCanvas(this.canvasRef.current, pixels);
    const mini = this.props.miniCanvasRef && this.props.miniCanvasRef.current;
    if (mini) this.drawToCanvas(mini, pixels);
  }

  render() {
    if (!this.state.connected) return null;
    if (this.props.showFullPanel === false) return null;
    return (
      <canvas
        ref={this.canvasRef}
        width={600}
        height={160}
        style={{ background: '#111', borderRadius: 4, width: '100%', marginTop: '1rem' }}
      />
    );
  }
}

export default App;
