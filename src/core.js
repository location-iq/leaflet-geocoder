/*
 * leaflet-geocoder-locationiq
 * Leaflet plugin to search (geocode) using LocationIQ Search
 * License: MIT
 * (c) Mapzen, LocationIQ
 */
'use strict';

// Polyfill console and its methods, if missing. (As it tends to be on IE8 (or lower))
// when the developer console is not open.
require('console-polyfill');

var L = require('leaflet');
var corslite = require('@mapbox/corslite');

// Import utility functions. TODO: switch to Lodash (no IE8 support) in v2
var throttle = require('./utils/throttle');
var escapeRegExp = require('./utils/escapeRegExp');

var VERSION = '1.9.6';
//todo: make this configurable
var MINIMUM_INPUT_LENGTH_FOR_AUTOCOMPLETE = 2;
var FULL_WIDTH_MARGIN = 20; // in pixels
var FULL_WIDTH_TOUCH_ADJUSTED_MARGIN = 4; // in pixels
var RESULTS_HEIGHT_MARGIN = 20; // in pixels
//todo: make this configurable
var API_RATE_LIMIT = 300; // in ms, throttled time between subsequent requests to API
// Text strings in this geocoder.
var TEXT_STRINGS = {
  'INPUT_PLACEHOLDER': 'Search',
  'INPUT_TITLE_ATTRIBUTE': 'Search',
  'RESET_TITLE_ATTRIBUTE': 'Reset',
  'NO_RESULTS': 'No results were found.',
  // Error codes.
  // https://locationiq.com/docs/
  'ERROR_403': 'A valid API key is needed for this search feature.',
  'ERROR_404': 'No results were found',
  'ERROR_408': 'The search service took too long to respond. Try again in a second.',
  'ERROR_429': 'There were too many requests. Try again in a second.',
  'ERROR_500': 'The search service is not working right now. Please try again in a second.',
  'ERROR_502': 'Connection lost. Please try again in a second.',
  // Unhandled error code
  'ERROR_DEFAULT': 'The search service is having problems :-('
};

var Geocoder = L.Control.extend({

  version: VERSION,

  // L.Evented is present in Leaflet v1+
  // L.Mixin.Events is legacy; was deprecated in Leaflet v1 and will start
  // logging deprecation warnings in console in v1.1
  includes: L.Evented ? L.Evented.prototype : L.Mixin.Events,

  options: {
    position: 'topleft',
    attribution: 'Search by <a href="https://locationiq.com/?ref=leaflet-geocoder">LocationIQ</a>',
    url: 'https://api.locationiq.com/v1',
    placeholder: null, // Note: this is now just an alias for textStrings.INPUT_PLACEHOLDER
    bounds: false,
    focus: true,
    layers: null,
    panToPoint: true,
    pointIcon: true, // 'images/point_icon.png',
    polygonIcon: true, // 'images/polygon_icon.png',
    fullWidth: 650,
    markers: true,
    overrideBbox: false,
    expanded: false,
    autocomplete: true,
    textStrings: TEXT_STRINGS,
    limit: 6 //limits responses from online
  },

  initialize: function (apiKey, options) {
    // For IE8 compatibility (if XDomainRequest is present),
    // we set the default value of options.url to the protocol-relative
    // version, because XDomainRequest does not allow http-to-https requests
    // This is set first so it can always be overridden by the user
    if (window.XDomainRequest) {
      this.options.url = '//api.locationiq.com/v1';
    }

    // If the apiKey is omitted entirely and the
    // first parameter is actually the options
    if (typeof apiKey === 'object' && !!apiKey) {
      options = apiKey;
    } else {
      this.apiKey = apiKey;
    }

    // Deprecation warnings
    // If options.latlng is defined, warn. (Do not check for falsy values, because it can be set to false.)
    if (options && typeof options.latlng !== 'undefined') {
      // Set user-specified latlng to focus option, but don't overwrite if it's already there
      if (typeof options.focus === 'undefined') {
        options.focus = options.latlng;
      }
      console.warn('[leaflet-geocoder-locationiq] DEPRECATION WARNING:',
        'As of v1.6.0, the `latlng` option is deprecated. It has been renamed to `focus`. `latlng` will be removed in a future version.');
    }

    // Deprecate `title` option
    if (options && typeof options.title !== 'undefined') {
      options.textStrings = options.textStrings || {};
      options.textStrings.INPUT_TITLE_ATTRIBUTE = options.title;
      console.warn('[leaflet-geocoder-locationiq] DEPRECATION WARNING:',
        'As of v1.8.0, the `title` option is deprecated. Please set the property `INPUT_TITLE_ATTRIBUTE` on the `textStrings` option instead. `title` will be removed in a future version.');
    }

    // `placeholder` is not deprecated, but it is an alias for textStrings.INPUT_PLACEHOLDER
    if (options && typeof options.placeholder !== 'undefined') {
      // textStrings.INPUT_PLACEHOLDER has priority, if defined.
      if (!(options.textStrings && typeof options.textStrings.INPUT_PLACEHOLDER !== 'undefined')) {
        options.textStrings = options.textStrings || {};
        options.textStrings.INPUT_PLACEHOLDER = options.placeholder;
      }
    }

    // Merge any strings that are not customized
    if (options && typeof options.textStrings === 'object') {
      for (var prop in this.options.textStrings) {
        if (typeof options.textStrings[prop] === 'undefined') {
          options.textStrings[prop] = this.options.textStrings[prop];
        }
      }
    }

    // Now merge user-specified options
    L.Util.setOptions(this, options);
    this.markers = [];

  },

  /**
   * Resets the geocoder control to an empty state.
   *
   * @public
   */
  reset: function () {
    this._input.value = '';
    L.DomUtil.addClass(this._reset, 'leaflet-locationiq-hidden');
    this.removeMarkers();
    this.clearResults();
    this.fire('reset');
  },

  getBoundingBoxParam: function (params) {
    /*
     * this.options.bounds can be one of the following
     * true //Boolean - take the map bounds
     * false //Boolean - no bounds
     * L.latLngBounds(...) //Object
     * [[10, 10], [40, 60]] //Array
    */
    var bounds = this.options.bounds;

    // If falsy, bail
    if (!bounds) {
      return params;
    }

    // If set to true, use map bounds
    // If it is a valid L.LatLngBounds object, get its values
    // If it is an array, try running it through L.LatLngBounds
    if (bounds === true && this._map) {
      bounds = this._map.getBounds();
      params = makeParamsFromLeaflet(params, bounds);
    } else if (typeof bounds === 'object' && bounds.isValid && bounds.isValid()) {
      params = makeParamsFromLeaflet(params, bounds);
    } else if (L.Util.isArray(bounds)) {
      var latLngBounds = L.latLngBounds(bounds);
      if (latLngBounds.isValid && latLngBounds.isValid()) {
        params = makeParamsFromLeaflet(params, latLngBounds);
      }
    }
    //todo: autocomplete does not currently support bounds restrictions
    // params['bounded'] = 1;

    function makeParamsFromLeaflet (params, latLngBounds) {
      //viewbox=<maxLon>,<maxLat>,<minLon>,<minLat>
      params['viewbox'] = latLngBounds.getEast() + ',' + latLngBounds.getNorth() + ',' + latLngBounds.getWest() + ',' + latLngBounds.getSouth();      
      return params;
    }

    return params;
  },

  getFocusParam: function (params) {
    /**
     * this.options.focus can be one of the following
     * [50, 30]           // Array
     * {lon: 30, lat: 50} // Object
     * {lat: 50, lng: 30} // Object
     * L.latLng(50, 30)   // Object
     * true               // Boolean - take the map center
     * false              // Boolean - No latlng to be considered
     */
    var focus = this.options.focus;

    if (!focus) {
      return params;
    }

    if (focus === true && this._map) {
      // If focus option is Boolean true, use current map center
      var mapCenter = this._map.getCenter();
      //convert this to viewbox
      params = makeViewboxFromLatLon(params, mapCenter);
    } else if (typeof focus === 'object') {
      // Accepts array, object and L.latLng form
      // Constructs the latlng object using Leaflet's L.latLng()
      // [50, 30]
      // {lon: 30, lat: 50}
      // {lat: 50, lng: 30}
      // L.latLng(50, 30)
      var latlng = L.latLng(focus);
      params = makeViewboxFromLatLon(params, latlng);
    }

    function makeViewboxFromLatLon (params, latlng) {
      //viewbox=<maxLon>,<maxLat>,<minLon>,<minLat>
      params['viewbox'] = latlng.lng + ',' + latlng.lat + ',' + latlng.lng + ',' + latlng.lat;
      return params;
    }

    return params;
  },

  // @method getParams(params: Object)
  // Collects all the parameters in a single object from various options,
  // including options.bounds, options.focus, options.layers, the api key,
  // and any params that are provided as a argument to this function.
  // Note that options.params will overwrite any of these
  getParams: function (params) {
    params = params || {};
    //this doesn't work with autocomplete, just search
    params = this.getBoundingBoxParam(params);
    params = this.getFocusParam(params);
    //todo: support searching by type class (POI, country, etc)
    // params = this.getClassType(params);

    // Search API key
    if (this.apiKey) {
      params.key = this.apiKey;
    }
    
    params.format = 'json';

    if (this.options.source !== undefined) {
      params.source = this.options.source;
    }

    var newParams = this.options.params;

    if (!newParams) {
      return params;
    }

    if (typeof newParams === 'object') {
      for (var prop in newParams) {
        params[prop] = newParams[prop];
      }
    }

    return params;
  },

  serialize: function (params) {
    var data = '';

    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        var param = params[key];
        var type = param.toString();
        var value;

        if (data.length) {
          data += '&';
        }

        switch (type) {
          case '[object Array]':
            value = (param[0].toString() === '[object Object]') ? JSON.stringify(param) : param.join(',');
            break;
          case '[object Object]':
            value = JSON.stringify(param);
            break;
          case '[object Date]':
            value = param.valueOf();
            break;
          default:
            value = param;
            break;
        }

        data += encodeURIComponent(key) + '=' + encodeURIComponent(value);
      }
    }

    return data;
  },

  search: function (input) {
    // Prevent lack of input from sending a malformed query to locationiq
    if (!input) return;

    var url = this.options.url + '/autocomplete.php'; //todo: switch this to search endpoint to fetch complete result on return keydown
    var params = {
      q: input
    };

    this.callLocationIQ(url, params, 'search');
  },

  autocomplete: throttle(function (input) {
    // Prevent lack of input from sending a malformed query to locationiq
    if (!input) return;

    var url = this.options.url + '/autocomplete.php';
    var params = {
      q: input,
      autocomplete: 1
    };

    this.callLocationIQ(url, params, 'autocomplete');
  }, API_RATE_LIMIT),

  // Timestamp of the last response which was successfully rendered to the UI.
  // The time represents when the request was *sent*, not when it was recieved.
  maxReqTimestampRendered: new Date().getTime(),

  callLocationIQ: function (endpoint, params, type) {
    params = this.getParams(params);

    L.DomUtil.addClass(this._search, 'leaflet-locationiq-loading');

    // Track when the request began
    var reqStartedAt = new Date().getTime();

    var paramString = this.serialize(params);
    var url = endpoint + '?' + paramString;
    var self = this; // IE8 cannot .bind(this) without a polyfill.
    function handleResponse (err, response) {
      L.DomUtil.removeClass(self._search, 'leaflet-locationiq-loading');
      var results;

      try {
        results = JSON.parse(response.responseText);
      } catch (e) {
        err = {
          //we could get these errors if the request is interrupted, so changing from 500 to 404
          code: 404,
          message: 'Parse Error' // TODO: string
        };
      }

      if (err) {
        var errorMessage;
        switch (err.code) {
          // Error codes.
          // https://locationiq.com/docs
          case 403:
            errorMessage = self.options.textStrings['ERROR_403'];
            break;
          case 404:
            errorMessage = self.options.textStrings['ERROR_404'];
            break;
          case 408:
            errorMessage = self.options.textStrings['ERROR_408'];
            break;
          case 429:
            errorMessage = self.options.textStrings['ERROR_429'];
            break;
          case 500:
            errorMessage = self.options.textStrings['ERROR_500'];
            break;
          case 502:
            errorMessage = self.options.textStrings['ERROR_502'];
            break;
          // Note the status code is 0 if CORS is not enabled on the error response
          default:
            errorMessage = self.options.textStrings['ERROR_DEFAULT'];
            break;
        }
        self.showMessage(errorMessage);
        self.fire('error', {
          results: results,
          endpoint: endpoint,
          requestType: type,
          params: params,
          errorCode: err.code,
          errorMessage: errorMessage
        });
      }

      // There might be an error message from the geocoding service itself
      if (results && results.geocoding && results.geocoding.errors) {
        errorMessage = results.geocoding.errors[0];
        self.showMessage(errorMessage);
        self.fire('error', {
          results: results,
          endpoint: endpoint,
          requestType: type,
          params: params,
          errorCode: err.code,
          errorMessage: errorMessage
        });
        return;
      }

      // Autocomplete and search responses
      if (results && results.length > 0) {
        // Check if request is stale:
        // Only for autocomplete or search endpoints
        // Ignore requests if input is currently blank
        // Ignore requests that started before a request which has already
        // been successfully rendered on to the UI.
        if (type === 'autocomplete' || type === 'search') {
          if (self._input.value === '' || self.maxReqTimestampRendered >= reqStartedAt) {
            return;
          } else {
            // Record the timestamp of the request.
            self.maxReqTimestampRendered = reqStartedAt;
          }
        }

        // Show results
        if (type === 'autocomplete' || type === 'search') {
          self.showResults(results, params.q);
        }

        // Fire event
        self.fire('results', {
          results: results,
          endpoint: endpoint,
          requestType: type,
          params: params
        });
      }
    }

    corslite(url, handleResponse, true);
  },

  highlight: function (text, focus) {
    var r = RegExp('(' + escapeRegExp(focus) + ')', 'gi');
    return text.replace(r, '<strong>$1</strong>');
  },

  getIconType: function (layer) {
    var pointIcon = this.options.pointIcon;
    var polygonIcon = this.options.polygonIcon;
    var classPrefix = 'leaflet-locationiq-layer-icon-';

    if (layer.match('venue') || layer.match('address')) {
      if (pointIcon === true) {
        return {
          type: 'class',
          value: classPrefix + 'point'
        };
      } else if (pointIcon === false) {
        return false;
      } else {
        return {
          type: 'image',
          value: pointIcon
        };
      }
    } else {
      if (polygonIcon === true) {
        return {
          type: 'class',
          value: classPrefix + 'polygon'
        };
      } else if (polygonIcon === false) {
        return false;
      } else {
        return {
          type: 'image',
          value: polygonIcon
        };
      }
    }
  },

  showResults: function (features, input) {
    // Exit function if there are no features
    if (features.length === 0) {
      this.showMessage(this.options.textStrings['NO_RESULTS']);
      return;
    }

    var resultsContainer = this._results;

    // Reset and display results container
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';
    // manage result box height
    resultsContainer.style.maxHeight = (this._map.getSize().y - resultsContainer.offsetTop - this._container.offsetTop - RESULTS_HEIGHT_MARGIN) + 'px';

    var list = L.DomUtil.create('ul', 'leaflet-locationiq-list', resultsContainer);

    for (var i = 0, j = features.length; i < j; i++) {
      var feature = features[i];
      var resultItem = L.DomUtil.create('li', 'leaflet-locationiq-result', list);
      resultItem.feature = feature;
      resultItem.coords = {lon: feature.lon, lat: feature.lat};
      if(typeof feature.display_place !== 'undefined') {
        resultItem.name = feature.display_place;
      } else {
        resultItem.name = " ";
      }
      if(typeof feature.display_address !== 'undefined') {
        resultItem.address = feature.display_address;
      } else {
        resultItem.address = " ";
      }
      
      if(typeof feature.display_name !== 'undefined') {
        resultItem.display_name = feature.display_name;
      } else {
        resultItem.display_name = " ";
      }

      resultItem.innerHTML += 
        "<div class='name'>" + this.highlight(resultItem.name, input) + "</div>"
        + "<div class='address'>" + this.highlight(resultItem.address, input) + "</div>";
    }
  },

  showMessage: function (text) {
    var resultsContainer = this._results;

    // Reset and display results container
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';

    var messageEl = L.DomUtil.create('div', 'leaflet-locationiq-message', resultsContainer);

    // Set text. This is the most cross-browser compatible method
    // and avoids the issues we have detecting either innerText vs textContent
    // (e.g. Firefox cannot detect textContent property on elements, but it's there)
    messageEl.appendChild(document.createTextNode(text));
  },

  removeMarkers: function () {
    if (this.options.markers) {
      for (var i = 0; i < this.markers.length; i++) {
        this._map.removeLayer(this.markers[i]);
      }
      this.markers = [];
    }
  },

  showMarker: function (text, latlng) {
    this._map.setView(latlng, this._map.getZoom() || 8);

    var markerOptions = (typeof this.options.markers === 'object') ? this.options.markers : {};

    if (this.options.markers) {
      var marker = new L.marker(latlng, markerOptions).bindPopup(text); // eslint-disable-line new-cap
      this._map.addLayer(marker);
      this.markers.push(marker);
      marker.openPopup();
    }
  },

  /**
   * Fits the map view to a given bounding box.
   * This method expects the array to be passed directly and it will be converted
   * to a boundary parameter for Leaflet's fitBounds().
   */
  fitBoundingBox: function (bbox) {
    this._map.fitBounds([
      [ bbox[1], bbox[0] ],
      [ bbox[3], bbox[2] ]
    ], {
      animate: true,
      maxZoom: 16
    });
  },

  setSelectedResult: function (selected, originalEvent) {
    var latlng = L.latLng(selected.coords.lat, selected.coords.lon);
    this._input.value = (selected.display_name) || selected.textContent || selected.innerText;
    if (selected.boundingbox && !options.overrideBbox) {
      this.removeMarkers();
      this.fitBoundingBox(selected.boundingbox);       
    } else {
      this.removeMarkers();
      this.showMarker(selected.innerHTML, latlng);
    }
    this.fire('select', {
      originalEvent: originalEvent,
      latlng: latlng,
      feature: selected
    });
    this.blur();

  },

  /**
   * Convenience function for focusing on the input
   * A `focus` event is fired, but it is not fired here. An event listener
   * was added to the _input element to forward the native `focus` event.
   *
   * @public
   */
  focus: function () {
    // If not expanded, expand this first
    if (!L.DomUtil.hasClass(this._container, 'leaflet-locationiq-expanded')) {
      this.expand();
    }
    this._input.focus();
  },

  /**
   * Removes focus from geocoder control
   * A `blur` event is fired, but it is not fired here. An event listener
   * was added on the _input element to forward the native `blur` event.
   *
   * @public
   */
  blur: function () {
    this._input.blur();
    this.clearResults();
    if (this._input.value === '' && this._results.style.display !== 'none') {
      L.DomUtil.addClass(this._reset, 'leaflet-locationiq-hidden');
      if (!this.options.expanded) {
        this.collapse();
      }
    }
  },

  clearResults: function (force) {
    // Hide results from view
    this._results.style.display = 'none';

    // Destroy contents if input has also cleared
    // OR if force is true
    if (this._input.value === '' || force === true) {
      this._results.innerHTML = '';
    }

    // Turn on scrollWheelZoom, if disabled. (`mouseout` does not fire on
    // the results list when it's closed in this way.)
    this._enableMapScrollWheelZoom();
  },

  expand: function () {
    L.DomUtil.addClass(this._container, 'leaflet-locationiq-expanded');
    this.setFullWidth();
    this.fire('expand');
  },

  collapse: function () {
    // 'expanded' options check happens outside of this function now
    // So it's now possible for a script to force-collapse a geocoder
    // that otherwise defaults to the always-expanded state
    L.DomUtil.removeClass(this._container, 'leaflet-locationiq-expanded');
    this._input.blur();
    this.clearFullWidth();
    this.clearResults();
    this.fire('collapse');
  },

  // Set full width of expanded input, if enabled
  setFullWidth: function () {
    if (this.options.fullWidth) {
      // If fullWidth setting is a number, only expand if map container
      // is smaller than that breakpoint. Otherwise, clear width
      // Always ask map to invalidate and recalculate size first
      this._map.invalidateSize();
      var mapWidth = this._map.getSize().x;
      var touchAdjustment = L.Browser.touch ? FULL_WIDTH_TOUCH_ADJUSTED_MARGIN : 0;
      var width = mapWidth - FULL_WIDTH_MARGIN - touchAdjustment;
      if (typeof this.options.fullWidth === 'number' && mapWidth >= window.parseInt(this.options.fullWidth, 10)) {
        this.clearFullWidth();
        return;
      }
      this._container.style.width = width.toString() + 'px';
    }
  },

  clearFullWidth: function () {
    // Clear set width, if any
    if (this.options.fullWidth) {
      this._container.style.width = '';
    }
  },

  onAdd: function (map) {
    var container = L.DomUtil.create('div',
        'leaflet-locationiq-control leaflet-bar leaflet-control');

    this._body = document.body || document.getElementsByTagName('body')[0];
    this._container = container;
    this._input = L.DomUtil.create('input', 'leaflet-locationiq-input', this._container);
    this._input.spellcheck = false;

    // Forwards focus and blur events from input to geocoder
    L.DomEvent.addListener(this._input, 'focus', function (e) {
      this.fire('focus', { originalEvent: e });
    }, this);

    L.DomEvent.addListener(this._input, 'blur', function (e) {
      this.fire('blur', { originalEvent: e });
    }, this);

    // Only set if title option is not null or falsy
    if (this.options.textStrings['INPUT_TITLE_ATTRIBUTE']) {
      this._input.title = this.options.textStrings['INPUT_TITLE_ATTRIBUTE'];
    }

    // Only set if placeholder option is not null or falsy
    if (this.options.textStrings['INPUT_PLACEHOLDER']) {
      this._input.placeholder = this.options.textStrings['INPUT_PLACEHOLDER'];
    }

    this._search = L.DomUtil.create('a', 'leaflet-locationiq-search-icon', this._container);
    this._reset = L.DomUtil.create('div', 'leaflet-locationiq-close leaflet-locationiq-hidden', this._container);
    this._reset.innerHTML = '×';
    this._reset.title = this.options.textStrings['RESET_TITLE_ATTRIBUTE'];

    this._results = L.DomUtil.create('div', 'leaflet-locationiq-results leaflet-bar', this._container);

    if (this.options.expanded) {
      this.expand();
    }

    L.DomEvent
      .on(this._container, 'click', function (e) {
        // Child elements with 'click' listeners should call
        // stopPropagation() to prevent that event from bubbling to
        // the container & causing it to fire too greedily
        this._input.focus();
      }, this)
      .on(this._input, 'focus', function (e) {
        if (this._input.value && this._results.children.length) {
          this._results.style.display = 'block';
        }
      }, this)
      .on(this._map, 'click', function (e) {
        // Does what you might expect a _input.blur() listener might do,
        // but since that would fire for any reason (e.g. clicking a result)
        // what you really want is to blur from the control by listening to clicks on the map
        this.blur();
      }, this)
      .on(this._search, 'click', function (e) {
        L.DomEvent.stopPropagation(e);

        // Toggles expanded state of container on click of search icon
        if (L.DomUtil.hasClass(this._container, 'leaflet-locationiq-expanded')) {
          // If expanded option is true, just focus the input
          if (this.options.expanded === true) {
            this._input.focus();
          } else {
            // Otherwise, toggle to hidden state
            L.DomUtil.addClass(this._reset, 'leaflet-locationiq-hidden');
            this.collapse();
          }
        } else {
          // If not currently expanded, clicking here always expands it
          if (this._input.value.length > 0) {
            L.DomUtil.removeClass(this._reset, 'leaflet-locationiq-hidden');
          }
          this.expand();
          this._input.focus();
        }
      }, this)
      .on(this._reset, 'click', function (e) {
        this.reset();
        this._input.focus();
        L.DomEvent.stopPropagation(e);
      }, this)
      .on(this._input, 'keydown', function (e) {
        var list = this._results.querySelectorAll('.leaflet-locationiq-result');
        var selected = this._results.querySelectorAll('.leaflet-locationiq-selected')[0];
        var selectedPosition;
        var self = this;

        var panToPoint = function (selected, options) {
          if (selected && options.panToPoint) {
            if (selected.boundingbox && !options.overrideBbox) {
              self.removeMarkers();
              self.fitBoundingBox(selected.boundingbox);
            } else {
              self.removeMarkers();
              self.showMarker(selected.innerHTML, L.latLng(selected.coords.lat, selected.coords.lon));
            }
          }
        };

        var scrollSelectedResultIntoView = function (selected) {
          var selectedRect = selected.getBoundingClientRect();
          var resultsRect = self._results.getBoundingClientRect();
          // Is the selected element not visible?
          if (selectedRect.bottom > resultsRect.bottom) {
            self._results.scrollTop = selected.offsetTop + selected.offsetHeight - self._results.offsetHeight;
          } else if (selectedRect.top < resultsRect.top) {
            self._results.scrollTop = selected.offsetTop;
          }
        };

        for (var i = 0; i < list.length; i++) {
          if (list[i] === selected) {
            selectedPosition = i;
            break;
          }
        }

        // TODO cleanup
        switch (e.keyCode) {
          // 13 = enter
          case 13:
            if (selected) {
              this.setSelectedResult(selected, e);
            } else {
              // perform a full text search on enter
              var text = (e.target || e.srcElement).value;
              //todo: do we really need this?
              this.search(text);
            }
            L.DomEvent.preventDefault(e);
            break;
          // 38 = up arrow
          case 38:
            // Ignore key if there are no results or if list is not visible
            if (list.length === 0 || this._results.style.display === 'none') {
              return;
            }

            if (selected) {
              L.DomUtil.removeClass(selected, 'leaflet-locationiq-selected');
            }

            var previousItem = list[selectedPosition - 1];
            var highlighted = (selected && previousItem) ? previousItem : list[list.length - 1]; // eslint-disable-line no-redeclare

            L.DomUtil.addClass(highlighted, 'leaflet-locationiq-selected');
            scrollSelectedResultIntoView(highlighted);
            panToPoint(highlighted, this.options);
            this._input.value = (highlighted.name + ", " + highlighted.address) || highlighted.textContent || highlighted.innerText;
            this.fire('highlight', {
              originalEvent: e,
              latlng: L.latLng(highlighted.lat, highlighted.lon),
              feature: highlighted
            });

            L.DomEvent.preventDefault(e);
            break;
          // 40 = down arrow
          case 40:
            // Ignore key if there are no results or if list is not visible
            if (list.length === 0 || this._results.style.display === 'none') {
              return;
            }

            if (selected) {
              L.DomUtil.removeClass(selected, 'leaflet-locationiq-selected');
            }

            var nextItem = list[selectedPosition + 1];
            var highlighted = (selected && nextItem) ? nextItem : list[0]; // eslint-disable-line no-redeclare

            L.DomUtil.addClass(highlighted, 'leaflet-locationiq-selected');
            scrollSelectedResultIntoView(highlighted);
            panToPoint(highlighted, this.options);
            this._input.value = (highlighted.name + ", " + highlighted.address) || highlighted.textContent || highlighted.innerText;
            this.fire('highlight', {
              originalEvent: e,
              latlng: L.latLng(highlighted.lat, highlighted.lon),
              feature: highlighted
            });

            L.DomEvent.preventDefault(e);
            break;
          // all other keys
          default:
            break;
        }
      }, this)
      .on(this._input, 'keyup', function (e) {
        var key = e.which || e.keyCode;
        var text = (e.target || e.srcElement).value;

        if (text.length > 0) {
          L.DomUtil.removeClass(this._reset, 'leaflet-locationiq-hidden');
        } else {
          L.DomUtil.addClass(this._reset, 'leaflet-locationiq-hidden');
        }

        // Ignore all further action if the keycode matches an arrow
        // key (handled via keydown event)
        if (key === 13 || key === 38 || key === 40) {
          return;
        }

        // keyCode 27 = esc key (esc should clear results)
        if (key === 27) {
          // If input is blank or results have already been cleared
          // (perhaps due to a previous 'esc') then pressing esc at
          // this point will blur from input as well.
          if (text.length === 0 || this._results.style.display === 'none') {
            this._input.blur();

            if (!this.options.expanded && L.DomUtil.hasClass(this._container, 'leaflet-locationiq-expanded')) {
              this.collapse();
            }
          }

          // Clears results
          this.clearResults(true);
          L.DomUtil.removeClass(this._search, 'leaflet-locationiq-loading');
          return;
        }

        if (text !== this._lastValue) {
          this._lastValue = text;

          if (text.length >= MINIMUM_INPUT_LENGTH_FOR_AUTOCOMPLETE && this.options.autocomplete === true) {
            this.autocomplete(text);
          } else {
            this.clearResults(true);
          }
        }
      }, this)
      .on(this._results, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);

        var _selected = this._results.querySelectorAll('.leaflet-locationiq-selected')[0];
        if (_selected) {
          L.DomUtil.removeClass(_selected, 'leaflet-locationiq-selected');
        }

        var selected = e.target || e.srcElement; /* IE8 */
        var findParent = function () {
          if (!L.DomUtil.hasClass(selected, 'leaflet-locationiq-result')) {
            selected = selected.parentElement;
            if (selected) {
              findParent();
            }
          }
          return selected;
        };

        // click event can be registered on the child nodes
        // that does not have the required coords prop
        // so its important to find the parent.
        findParent();

        // If nothing is selected, (e.g. it's a message, not a result),
        // do nothing.
        if (selected) {
          L.DomUtil.addClass(selected, 'leaflet-locationiq-selected');
          this.setSelectedResult(selected, e);
        }
      }, this);

    // Recalculate width of the input bar when window resizes
    if (this.options.fullWidth) {
      L.DomEvent.on(window, 'resize', function (e) {
        if (L.DomUtil.hasClass(this._container, 'leaflet-locationiq-expanded')) {
          this.setFullWidth();
        }
      }, this);
    }

    L.DomEvent.on(this._results, 'mouseover', this._disableMapScrollWheelZoom, this);
    L.DomEvent.on(this._results, 'mouseout', this._enableMapScrollWheelZoom, this);
    L.DomEvent.on(this._map, 'mousedown', this._onMapInteraction, this);
    L.DomEvent.on(this._map, 'touchstart', this._onMapInteraction, this);

    L.DomEvent.disableClickPropagation(this._container);
    if (map.attributionControl) {
      map.attributionControl.addAttribution(this.options.attribution);
    }
    return container;
  },

  _onMapInteraction: function (event) {
    this.blur();

    // Only collapse if the input is clear, and is currently expanded.
    // Disabled if expanded is set to true
    if (!this.options.expanded) {
      if (!this._input.value && L.DomUtil.hasClass(this._container, 'leaflet-locationiq-expanded')) {
        this.collapse();
      }
    }
  },

  _disableMapScrollWheelZoom: function (event) {
    // Prevent scrolling over results list from zooming the map, if enabled
    // Skip if it's already disabled. This prevents overriding the original
    // map.scrollWheelZoom setting.
    if (!this._map.scrollWheelZoom.enabled()) {
      return;
    }

    this._scrollWheelZoomEnabled = this._map.scrollWheelZoom.enabled();
    if (this._scrollWheelZoomEnabled) {
      this._map.scrollWheelZoom.disable();
    }
  },

  _enableMapScrollWheelZoom: function (event) {
    // Re-enable scroll wheel zoom (if previously enabled) after
    // leaving the results box
    if (this._scrollWheelZoomEnabled) {
      this._map.scrollWheelZoom.enable();
    }
  },

  onRemove: function (map) {
    if (map.attributionControl) {
      map.attributionControl.removeAttribution(this.options.attribution);
    }
  }
});

module.exports = Geocoder;
