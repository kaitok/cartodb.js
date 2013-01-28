/** Usage:
*
* Add Infowindow model:
*
* var infowindowModel = new cdb.geo.ui.InfowindowModel({
*   template_name: 'templates/map/infowindow',
*   latlng: [72, -45],
*   offset: [100, 10]
* });
*
* var infowindow = new cdb.geo.ui.Infowindow({
*   model: infowindowModel,
*   mapView: mapView
* });
*
* Show the infowindow:
* infowindow.showInfowindow();
*
*/

cdb.geo.ui.InfowindowModel = Backbone.Model.extend({
  SYSTEM_COLUMNS: ['the_geom', 'the_geom_webmercator', 'created_at', 'updated_at', 'cartodb_id', 'cartodb_georef_status'],

  defaults: {
    template_name: 'geo/infowindow',
    latlng: [0, 0],
    offset: [28, 0], // offset of the tip calculated from the bottom left corner
    autoPan: true,
    content: "",
    visibility: false,
    fields: null // contains the fields displayed in the infowindow
  },

  clearFields: function() {
    this.set({fields: []});
  },

  saveFields: function() {
    this.set('old_fields', _.clone(this.get('fields')));
  },

  fieldCount: function() {
    return this.get('fields').length
  },

  restoreFields: function(whiteList) {
     var fields = this.get('old_fields')
     if(whiteList) {
       fields = fields.filter(function(f) {
          return _.contains(whiteList, f.name);
       });
     }
     if(fields && fields.length) {
       this._setFields(fields);
     }
     this.unset('old_fields');
  },

  _cloneFields: function() {
    return _(this.get('fields')).map(function(v) {
      return _.clone(v);
    });
  },

  _setFields: function(f) {
    f.sort(function(a, b) { return a.position -  b.position; });
    this.set({'fields': f});
  },

  sortFields: function() {
    this.get('fields').sort(function(a, b) { return a.position - b.position; });
  },

  _addField: function(fieldName, at) {
    var dfd = $.Deferred();
    if(!this.containsField(fieldName)) {
      var fields = this.get('fields');
      if(fields) {
        at = at === undefined ? fields.length: at;
        fields.push({name: fieldName, title: true, position: at});
      } else {
        at = at === undefined ? 0 : at;
        this.set('fields', [{name: fieldName, title: true, position: at}])
      }
    }
    dfd.resolve();
    return dfd.promise();
  },

  addField: function(fieldName, at) {
    var self = this;
    $.when(this._addField(fieldName, at)).then(function() {
      self.sortFields();
      self.trigger('change:fields');
      self.trigger('add:fields');
    });
    return this;
  },

  getFieldProperty: function(fieldName, k) {
    if(this.containsField(fieldName)) {
      var fields = this.get('fields') || [];
      var idx = _.indexOf(_(fields).pluck('name'), fieldName);
      return fields[idx][k];
    }
    return null;
  },

  setFieldProperty: function(fieldName, k, v) {
    if(this.containsField(fieldName)) {
      var fields = this._cloneFields() || [];
      var idx = _.indexOf(_(fields).pluck('name'), fieldName);
      fields[idx][k] = v;
      this._setFields(fields);
    }
    return this;
  },

  getFieldPos: function(fieldName) {
    var p = this.getFieldProperty(fieldName, 'position');
    if(p == undefined) {
      return Number.MAX_VALUE;
    }
    return p;
  },

  containsField: function(fieldName) {
    var fields = this.get('fields') || [];
    return _.contains(_(fields).pluck('name'), fieldName);
  },

  removeField: function(fieldName) {
    if(this.containsField(fieldName)) {
      var fields = this._cloneFields() || [];
      var idx = _.indexOf(_(fields).pluck('name'), fieldName);
      if(idx >= 0) {
        fields.splice(idx, 1);
      }
      this._setFields(fields);
      this.trigger('remove:fields')
    }
    return this;
  }

});

cdb.geo.ui.Infowindow = cdb.core.View.extend({
  className: "infowindow",

  events: {
    // Close bindings
    "click .close":       "_closeInfowindow",
    "touchstart .close":  "_closeInfowindow",
    // Rest infowindow bindings
    "dragstart":          "_checkOrigin",
    "mousedown":          "_checkOrigin",
    "touchstart":         "_checkOrigin",
    "dblclick":           "_stopPropagation",
    "mousewheel":         "_stopPropagation",
    "DOMMouseScroll":     "_stopPropagation",
    "dbclick":            "_stopPropagation",
    "click":              "_stopPropagation"
  },

  initialize: function(){

    var that = this;

    _.bindAll(this, "render", "setLatLng", "changeTemplate", "_updatePosition", "_update", "toggle", "show", "hide");

    this.mapView = this.options.mapView;

    this.template = this.options.template ? this.options.template : cdb.templates.getTemplate(this.model.get("template_name"));

    this.add_related_model(this.model);

    this.model.bind('change:content',       this.render, this);
    this.model.bind('change:template_name', this.changeTemplate, this);
    this.model.bind('change:latlng',        this._update, this);
    this.model.bind('change:visibility',    this.toggle, this);
    this.model.bind('change:template',      this._compileTemplate, this);

    this.mapView.map.bind('change',         this._updatePosition, this);

    this.mapView.bind('zoomstart', function(){
      that.hide(true);
    });

    this.mapView.bind('zoomend', function() {
      that.show(true);
    });

    // Set min height to show the scroll
    this.minHeightToScroll = 180;

    this.render();
    this.$el.hide();

  },

  changeTemplate: function(template_name) {
    this.template = cdb.templates.getTemplate(this.model.get("template_name"));
    this.render();
  },

  _compileTemplate: function() {
    this.template = new cdb.core.Template({
       template: this.model.get('template'),
       type: this.model.get('template_type') || 'mustache'
    }).asFunction()

    this.render();
  },

  _checkOrigin: function(ev) {
    // If the mouse down come from jspVerticalBar
    // dont stop the propagation, but if the event
    // is a touchstart, stop the propagation
    var come_from_scroll = (($(ev.target).closest(".jspVerticalBar").length > 0) && (ev.type != "touchstart"));

    if (!come_from_scroll) {
      ev.stopPropagation();
    }
  },

  /**
   *  Convert values to string unless value is NULL
   */
  _fieldsToString: function(attrs) {
    if (attrs.content && attrs.content.fields) {
      attrs.content.fields = _.map(attrs.content.fields, function(attr) {
        // Check null or undefined :| and set both to empty == ''
        if (attr.value == null || attr.value == undefined) {
          attr.value = '';
        }

        // Cast all values to string due to problems with Mustache 0 number rendering
        var new_value = attr.value.toString();

        // But if we have some empty values (null)
        // we must make them null to display them correctly
        // ARGGG!
        if (new_value == "") new_value = null;

        // store attribute
        attr.value = new_value;

        return attr;
      });
    }

    return attrs;
  },

  render: function() {

    if(this.template) {

      // If there is content, destroy the jscrollpane first, then remove the content.
      var $jscrollpane = this.$el.find(".cartodb-popup-content");
      if ($jscrollpane.length > 0 && $jscrollpane.data() != null) {
        $jscrollpane.data().jsp && $jscrollpane.data().jsp.destroy();
      }

      var attrs = _.clone(this.model.attributes);

      // Mustache doesn't support 0 values, we have to convert number to strings
      // before apply the template

      var fields = this._fieldsToString(attrs);

      this.$el.html($(this.template(fields)));

      // Hello jscrollpane hacks!
      // It needs some time to initialize, if not it doesn't render properly the fields
      // Check the height of the content + the header if exists
      var that = this;
      setTimeout(function() {
        var actual_height = that.$el.find(".cartodb-popup-content").outerHeight() + that.$el.find(".cartodb-popup-header").outerHeight();
        if (that.minHeightToScroll <= actual_height)
          that.$el.find(".cartodb-popup-content").jScrollPane({
            maintainPosition:       false,
            verticalDragMinHeight:  20
          });
      }, 1);


      // If the template is 'cover-enabled', load the cover
      this._loadCover();

    };

    return this;
  },

  _containsCover: function() {
    return this.$el.find(".cartodb-popup.header").attr("data-cover") ? true : false;
  },

  _getCoverURL: function() {

    var content = this.model.get("content");

    if (content && content.fields) {

      if (content.fields && content.fields.length > 0) {
        return content.fields[0].value;
      }
      return false;
    }

    return false;

  },

  /**
  * Attempts to load the cover URL and show it
  */
  _loadCover: function() {

    if (!this._containsCover()) return;

    var self = this;

    var
    $cover         = this.$el.find(".cover"),
    $imageNotFound = this.$el.find(".image_not_found");

    var url = this._getCoverURL();

    if (!this._isValidURL(url)) {
      $imageNotFound.fadeIn(250);
      return;
    }

    // configure spinner
    var
    target  = document.getElementById('spinner'),
    opts    = { lines: 9, length: 4, width: 2, radius: 4, corners: 1, rotate: 0, color: '#ccc', speed: 1, trail: 60, shadow: true, hwaccel: false, zIndex: 2e9 },
    spinner = new Spinner(opts).spin(target);

    // create the image
    var $img = $cover.find("img");

    $imageNotFound.hide();

    $img.hide(function() {
      this.remove();
    });

    $img = $("<img />").attr("src", url);
    $cover.append($img);

    $img.load(function(){
      spinner.stop();

      var w  = $img.width();
      var h  = $img.height();
      var cW = $cover.width();
      var cH = $cover.height();

      // Resize rules
      //if ( (w < cW && h < cH) ) $img.css({ top: "50%", left: "50%", marginTop: -1*h/2, marginLeft: -1*w/2 });
      if ( w > cW && h > cH && h > w )  $img.css({ height: cH });
      else $img.css({ width: cW });

      $img.fadeIn(300);
    })
    .error(function(){
      spinner.stop();
      $imageNotFound.fadeIn(250);
    });

  },

  /**
  * Return true if the provided URL is valid
  */
  _isValidURL: function(url) {

    if (url) {
      var urlPattern = /(http|ftp|https):\/\/[\w-]+(\.[\w-]+)+([\w.,@?^=%&amp;:\/~+#-]*[\w@?^=%&amp;\/~+#-])?/
      return url.match(urlPattern) != null ? true : false;
    }

    return false;

  },

  toggle: function() {
    this.model.get("visibility") ? this.show() : this.hide();
  },

  _stopPropagation: function(ev) {
    ev.stopPropagation();
  },

  _closeInfowindow: function(ev) {
    if (ev) {
      ev.preventDefault()
      ev.stopPropagation();
    }

    this.model.set("visibility",false);
  },

  /**
  * Set the correct position for the popup
  */
  setLatLng: function (latlng) {
    this.model.set("latlng", latlng);
    return this;
  },

  showInfowindow: function() {
    this.model.set("visibility", true);
  },

  show: function (no_pan) {
    var that = this;

    if (this.model.get("visibility")) {
      that.$el.css({ left: -5000 });
      that._update(no_pan);
    }

  },

  isHidden: function () {
    return !this.model.get("visibility");
  },

  hide: function (force) {
    if (force || !this.model.get("visibility")) this._animateOut();
  },

  _update: function (no_pan) {

    if(!this.isHidden()) {
      var delay = 0;

      if (!no_pan) {
        var delay = this._adjustPan();
      }

      this._updatePosition();
      this._animateIn(delay);
    }
  },

  _animateIn: function(delay) {
    if (!$.browser.msie || ($.browser.msie && $.browser.version.search("9.") != -1)) {
      this.$el.css({
        'marginBottom':'-10px',
        'display':'block',
        opacity:0
      });

      this.$el
      .delay(delay)
      .animate({
        opacity: 1,
        marginBottom: 0
      },300);
    } else {
      this.$el.show();
    }
  },

  _animateOut: function() {
    if (!$.browser.msie || ($.browser.msie && $.browser.version.search("9.") != -1)) {
      var that = this;
      this.$el.animate({
        marginBottom: "-10px",
        opacity:      "0",
        display:      "block"
      }, 180, function() {
        that.$el.css({display: "none"});
      });
    } else {
      this.$el.hide();
    }
  },

  /**
  * Update the position (private)
  */
  _updatePosition: function () {
    if(this.isHidden()) return;

    var
    offset          = this.model.get("offset")
    pos             = this.mapView.latLonToPixel(this.model.get("latlng")),
    x               = this.$el.position().left,
    y               = this.$el.position().top,
    containerHeight = this.$el.outerHeight(true),
    containerWidth  = this.$el.width(),
    left            = pos.x - offset[0],
    size            = this.mapView.getSize(),
    bottom          = -1*(pos.y - offset[1] - size.y);

    this.$el.css({ bottom: bottom, left: left });
  },

  _adjustPan: function (callback) {

    var offset = this.model.get("offset");

    if (!this.model.get("autoPan") || this.isHidden()) { return; }

    var
    x               = this.$el.position().left,
    y               = this.$el.position().top,
    containerHeight = this.$el.outerHeight(true) + 15, // Adding some more space
    containerWidth  = this.$el.width(),
    pos             = this.mapView.latLonToPixel(this.model.get("latlng")),
    adjustOffset    = {x: 0, y: 0};
    size            = this.mapView.getSize()
    wait_callback   = 0;

    if (pos.x - offset[0] < 0) {
      adjustOffset.x = pos.x - offset[0] - 10;
    }

    if (pos.x - offset[0] + containerWidth > size.x) {
      adjustOffset.x = pos.x + containerWidth - size.x - offset[0] + 10;
    }

    if (pos.y - containerHeight < 0) {
      adjustOffset.y = pos.y - containerHeight - 10;
    }

    if (pos.y - containerHeight > size.y) {
      adjustOffset.y = pos.y + containerHeight - size.y;
    }

    if (adjustOffset.x || adjustOffset.y) {
      this.mapView.panBy(adjustOffset);
      wait_callback = 300;
    }

    return wait_callback;
  }

});
