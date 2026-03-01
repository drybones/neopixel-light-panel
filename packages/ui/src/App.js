import React, { Component, useState, useEffect, useRef } from 'react';
import reactCSS from 'reactcss'
import { ChromePicker } from 'react-color';
import './App.css';

var shortid = require('shortid');

var baseUrl = process.env.REACT_APP_LIGHTPANEL_API_SERVER || 'http://localhost:3000';
var wsUrl = process.env.REACT_APP_LIGHTPANEL_WS_SERVER || baseUrl.replace(/^http(s?)/, 'ws$1').replace(/:\d+$/, ':3001');

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

class App extends Component {
  render() {
    return (
      <div className="App container">
        <h1 className="my-3">Lightpanel</h1>
        <PresetConfig/>
      </div>
    );
  }
}

class PresetConfig extends Component {
  constructor(props) {
    super(props);
    this.state = 
    {
      presets: [],
      currentPresetId: null,
      presetConfig: null,
      globalBrightness: 1.0,
    }
    this.handleWaveletChange = this.handleWaveletChange.bind(this);  
    this.handlePresetListClick = this.handlePresetListClick.bind(this);  
    this.handleNewWaveletClick = this.handleNewWaveletClick.bind(this);
    this.handleDeleteWaveletClick = this.handleDeleteWaveletClick.bind(this);
    this.handleNewPresetClick = this.handleNewPresetClick.bind(this);
    this.handleDeletePresetClick = this.handleDeletePresetClick.bind(this);
    this.handlePresetNameChange = this.handlePresetNameChange.bind(this);
    this.handleSoloWaveletClick = this.handleSoloWaveletClick.bind(this);
    this.handleGlobalBrightnessChange = this.handleGlobalBrightnessChange.bind(this);
    this.miniCanvasRef = React.createRef();
  }

  componentDidMount() {
    // Fetch the current preset only after we've got the list
    fetch(baseUrl+'/api/all_presets/')
      .then((result) => {
        return result.json();
      }).then((jsonresult) => {
        this.setState({presets: jsonresult});
        return fetch(baseUrl+'/api/current_preset_id/')
        .then((result) => {
          return result.text();
        }).then((textresult) => {
          this.setState({currentPresetId: textresult});
          this.fetchPresetConfig(textresult);
        });
      });

    // Can fetch the brightness in parallel
    fetch(baseUrl+'/api/brightness/')
      .then((result) => {
        return result.text();
      }).then((textresult) => {
        this.setState({globalBrightness: textresult});
      });
  }

  handlePresetListClick(id) {
    this.setState({currentPresetId: id});
    this.setLightPanelCurrentPresetId(id);
    this.fetchPresetConfig(id);
  }

  fetchPresetConfig(id) {
    let preset = this.state.presets.find(o => o.id === id);
    if(preset.type === 'fixed') {
      this.setState({presetConfig: null});
    } else {
      fetch(baseUrl+'/api/wave_config/'+preset.id)
        .then((result) => {
          return result.json();
        }).then((jsonresult) => {
          this.setState({presetConfig: jsonresult});
        });
    }
  }

  setGlobalBrightness(value) {
    fetch(baseUrl+'/api/brightness/'+value, {
      cache: 'no-cache', // *default, cache, reload, force-cache, only-if-cached
      headers: {
        'user-agent': 'Mozilla/4.0 MDN Example',
        'content-type': 'application/json'
      },
      method: 'PUT', // *GET, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *same-origin
      redirect: 'follow', // *manual, error
      referrer: 'no-referrer', // *client
    });
  }

  setLightPanelCurrentPresetId(id) {
    fetch(baseUrl+'/api/current_preset_id/'+id, {
      cache: 'no-cache', // *default, cache, reload, force-cache, only-if-cached
      headers: {
        'user-agent': 'Mozilla/4.0 MDN Example',
        'content-type': 'application/json'
      },
      method: 'PUT', // *GET, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *same-origin
      redirect: 'follow', // *manual, error
      referrer: 'no-referrer', // *client
    });
  }

  handleNewPresetClick() {
    let newPreset = {...defaultPreset};
    newPreset.id = shortid.generate();
    newPreset.wavelets = newPreset.wavelets.slice(); // Deeper copy on the array
    
    this.updateServerConfig(newPreset.id, newPreset)
      .then(this.setLightPanelCurrentPresetId(newPreset.id));

    let newPresetList = this.state.presets.slice();
    newPresetList.push({id: newPreset.id, name: newPreset.name});

    this.setState({
      presets: newPresetList,
      currentPresetId: newPreset.id,
      presetConfig : newPreset
    });
  }

  handleDeletePresetClick(id) {
    let newPresets = this.state.presets.slice();
    let thisPresetIndex = this.state.presets.findIndex(o => o.id === id);
    if(thisPresetIndex !== -1) {
      newPresets.splice(thisPresetIndex, 1);
    }

    this.setState({
      presets: newPresets,
    });

    if(this.state.currentPresetId === id) {
      this.setState({
        currentPresetId: this.state.presets[0].id, // The first is fixed, and "Off"
        presetConfig: null,
      })
    }

    fetch(baseUrl+'/api/wave_config/'+id, {
      cache: 'no-cache', // *default, cache, reload, force-cache, only-if-cached
      headers: {
        'user-agent': 'Mozilla/4.0 MDN Example',
        'content-type': 'application/json'
      },
      method: 'DELETE', // *GET, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *same-origin
      redirect: 'follow', // *manual, error
      referrer: 'no-referrer', // *client
    });
  }

  handleNewWaveletClick() {
    let newPresetConfig = {...this.state.presetConfig};
    let newWavelet = {...defaultWavelet};
    newWavelet.id = shortid.generate();
    newPresetConfig.wavelets.push(newWavelet);
    this.setState({
      presetConfig: newPresetConfig,
    });
    this.updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  handleDeleteWaveletClick(id) {
    let newPresetConfig = {...this.state.presetConfig};
    let thisWaveletIndex = newPresetConfig.wavelets.findIndex(w => w.id === id);
    if(thisWaveletIndex !== -1) {
      newPresetConfig.wavelets.splice(thisWaveletIndex, 1);
    }

    this.setState({
      presetConfig: newPresetConfig,
    });
    this.updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  handleSoloWaveletClick(id) {
    let newPresetConfig = {...this.state.presetConfig};
    newPresetConfig.wavelets.forEach(w => {
      w.solo = (w.id === id ? !(w.solo) : false);
    });

    this.setState({
      presetConfig: newPresetConfig,
    });
    this.updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  handleWaveletChange(waveletConfigId, event) {
    const target = event.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;
    
    let newPresetConfig = {...this.state.presetConfig};
    let wavelet = newPresetConfig.wavelets.find(w => w.id === waveletConfigId);

    // TODO Use a proper numeric input that handles this...
    const numericParams = new Set(["freq","lambda","delta","x","y","min","max"]);
    if(numericParams.has(name)) {
      if(name==='min' || name==='max') {
        // Push min / max through a function for non-linear slider behaviour
        wavelet[name] = sliderToMinMax(Number(value));    
      } else {
        wavelet[name] = Number(value);
      }
    } else {
      wavelet[name] = value;
    }

    // Keep the brightness sliders from inverting
    if(name === "min") {
      wavelet.max = Math.max(wavelet.min, wavelet.max);
    }
    if(name === "max") {
      wavelet.min = Math.min(wavelet.min, wavelet.max);
    }

    this.setState({
      presetConfig: newPresetConfig,
    });

    this.updateServerConfig(newPresetConfig.id, newPresetConfig);
  }

  handlePresetNameChange(event) {
    let newPresetConfig = {...this.state.presetConfig};
    let newPresets = this.state.presets.slice();
    
    newPresetConfig.name = event.target.value;
    let presetIndex = newPresets.findIndex(o => o.id === this.state.currentPresetId);
    if(presetIndex !== -1) {
      newPresets[presetIndex].name = newPresetConfig.name;
    }

    this.setState({
      presetConfig: newPresetConfig,
      presets: newPresets,
    });
    this.updateServerConfig(this.state.currentPresetId, newPresetConfig);
  }

  handleGlobalBrightnessChange(event) {
    let globalBrightness = sliderToMinMax(Number(event.target.value));
    this.setState({
      globalBrightness: globalBrightness,
    });
    this.setGlobalBrightness(globalBrightness);
  }

  updateServerConfig(id, config) {
    return this.putData(baseUrl+'/api/wave_config/'+id, config);
  }

  putData(url, data) {
    // Default options are marked with *
    return fetch(url, {
      body: JSON.stringify(data), // must match 'Content-Type' header
      cache: 'no-cache', // *default, cache, reload, force-cache, only-if-cached
      headers: {
        'user-agent': 'Mozilla/4.0 MDN Example',
        'content-type': 'application/json'
      },
      method: 'PUT', // *GET, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *same-origin
      redirect: 'follow', // *manual, error
      referrer: 'no-referrer', // *client
    });
  }
  
  render() {
    return (
      <div className="row">
        <div className="col-md-3">
          <BrightnessControl globalBrightness={this.state.globalBrightness} onGlobalBrightnessChange={this.handleGlobalBrightnessChange} />
          <PresetList presets={this.state.presets} currentPresetId={this.state.currentPresetId} onClick={this.handlePresetListClick} onNewPresetClick={this.handleNewPresetClick}/>
        </div>
        <div className="col-md">
          <PresetItem
            presetConfig={this.state.presetConfig}
            miniCanvasRef={this.miniCanvasRef}
            ledPanel={<LEDPanel miniCanvasRef={this.miniCanvasRef} />}
            onPresetNameChange={this.handlePresetNameChange}
            onDeletePresetClick={this.handleDeletePresetClick}
            onWaveletChange={this.handleWaveletChange}
            onNewWaveletClick={this.handleNewWaveletClick}
            onDeleteWaveletClick={this.handleDeleteWaveletClick}
            onSoloWaveletClick={this.handleSoloWaveletClick}
          />
        </div>
      </div>
    );
  }

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
      <button className="btn btn-secondary btn-block mt-2 mb-3" onClick={props.onNewPresetClick}>+ Add new preset</button>
    </div>
  );
}

function PresetItem(props) {
  const [isMini, setIsMini] = useState(false);
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
        <div ref={headerRef} className={`preset-item-header${isMini ? ' preset-item-header--mini' : ''}`}>
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
    this.handleColorChangeComplete = this.handleColorChangeComplete.bind(this);
  }

  handleClick = () => {
    this.setState({displayColorPicker: !this.state.displayColorPicker});
  }
  handleClose = () => {
    this.setState({ displayColorPicker: false })
  };
  
  handleColorChangeComplete(data, e) {
    // TODO Look up how to do this properly. The default argument from the color
    // picker is just the color data. There's also a browser mouse event.
    let syntheticEvent = {
      target: {
        name: "color", 
        value: data.hex,
        type: "colorpicker",
      }
    };
    return this.props.onWaveletChange(syntheticEvent);
  }

  render() {
    // From https://casesandberg.github.io/react-color/#examples
    const styles = reactCSS({
      'default': {
        color: {
          background: `${ this.props.waveletConfig.color }`,
        },
        popover: {
          position: 'absolute',
          zIndex: '25',
        },
        cover: {
          position: 'fixed',
          top: '0px',
          right: '0px',
          bottom: '0px',
          left: '0px',
        },
      },
    });

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
              <button className="btn btn-sm border form-control form-control-sm" style={ styles.color } onClick={ this.handleClick }>&nbsp;</button>
              { this.state.displayColorPicker ? 
                <div style={ styles.popover }>
                  <div style={ styles.cover } onClick={this.handleClose}/>
                  <ChromePicker color={this.props.waveletConfig.color} onChangeComplete={this.handleColorChangeComplete} disableAlpha={true} />
                </div>
                : null }
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
