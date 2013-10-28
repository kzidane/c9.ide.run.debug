define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "ui", "util", "debugger", "callstack"
    ];
    main.provides = ["variables"];
    return main;

    function main(options, imports, register) {
        var DebugPanel = imports.DebugPanel;
        var ui         = imports.ui;
        var callstack  = imports.callstack;
        var debug      = imports.debugger;
        var util       = imports.util;
        
        var markup   = require("text!./variables.xml");
        var Tree     = require("ace_tree/tree");
        var TreeData = require("ace_tree/data_provider");
        
        /***** Initialization *****/
        
        var plugin = new DebugPanel("Ajax.org", main.consumes, {
            caption : "Scope Variables",
            index   : 300
        });
        var emit   = plugin.getEmitter();
        
        var activeFrame, dbg, cached = {};
        var model, datagrid; // UI Elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new TreeData();
            model.emptyMessage = "No variables to display";
            
            // <a:each match="[scope|variable]" sort="[@name]" sort-method="scopesort">
            // <a:insert match="[scope]" />
            // <a:insert match="[node()[@children='true']]" />
            model.columns = [{
                caption : "Property",
                value   : "name",
                defaultValue : "Scope",
                width   : "40%",
                icon    : "debugger/genericvariable_obj.gif",
                tree    : "true"
            }, {
                caption : "Value",
                value   : "value",
                width   : "60%",
                editor  : "textbox" 
            }, {
                caption : "Type",
                value   : "[@type]",
                width   : "50"
            }];

            // Set and clear the dbg variable
            debug.on("attach", function(e){
                dbg = e.implementation;
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            debug.on("stateChange", function(e){
                plugin[e.action]();
            });
            
            callstack.on("scopeUpdate", function(e){
                updateScope(e.scope, e.variables);
            });
            callstack.on("framesLoad", function(e){
                // Clear the cached states of the variable datagrid
                clearCache();
            });
            
            // When clicking on a frame in the call stack show it 
            // in the variables datagrid
            callstack.on("frameActivate", function(e){
                // @todo reload the clicked frame recursively + keep state
                loadFrame(e.frame);
            }, plugin);
            
            // Variables
            plugin.on("expand", function(e){
                if (e.variable) {
                    //<a:insert match="[item[@children='true']]" get="{adbg.loadObject(dbg, %[.])}" />
                    dbg.getProperties(e.variable, function(err, properties){
                        if (err) return console.error(err);
                        
                        updateVariable(e.variable, properties, e.node);
                        e.expand();
                    });
                }
                // Local scope
                else if (e.scope.type == 1) {
                    //updateScope(e.scope);
                    e.expand();
                }
                // Other scopes
                else {
                    dbg.getScope(debug.activeFrame, e.scope, function(err, vars){
                        if (err) return console.error(err);
                        
                        updateScope(e.scope, vars);
                        e.expand();
                    });
                }
            }, plugin);
        }

        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
        
            datagrid = plugin.getElement("datagrid");
            
            var datagridEl = plugin.getElement("datagrid");
            datagrid = new Tree(datagridEl.$ext);
            datagrid.setOption("maxLines", 200);
            datagrid.setDataProvider(model);
            
            datagrid.on("contextmenu", function(){
                return false;
            });
            /*
            datagrid.on("beforeinsert", function(e){
                var node = e.xmlNode;

                var event = {
                    node   : node,
                    expand : function(){
                        var htmlNode = apf.xmldb.getHtmlNode(node, datagrid);
                        if (htmlNode)
                            datagrid.slideOpen(null, node, true);
                    }
                };
                if (node.localName == "scope") {
                    event.scope = activeFrame.findScope(node);
                }
                else if (node.localName == "variable") {
                    var parent = node.parentNode;
                    while (parent && parent.localName != "scope") {
                        parent = parent.parentNode;
                    }
                    
                    var scope = parent 
                        ? activeFrame.findScope(parent) 
                        : activeFrame;
                    event.variable = scope.findVariable(node);
                }

                emit("expand", event);
                return false;
            });
            
            datagrid.on("afterchange", function(e){
                var node  = e.xmlNode;
                var value = node.getAttribute("value");
                
                var parents    = [];
                var variable   = activeFrame.findVariable(node, null, parents);
                var oldValue   = variable.value;
                
                variable.value = value;
                
                function undo(){
                    variable.value = oldValue;
                    apf.xmldb.setAttribute(node, "value", oldValue);
                }
                
                // Set new value
                dbg.setVariable(variable, parents, 
                  value, debug.activeFrame, function(err){
                    if (err) 
                        return e.undo();
                        
                    // Reload properties of the variable
                    // dbg.getProperties(variable, function(err, properties){
                        updateVariable(variable, variable.properties, node);
                        
                        emit("variableEdit", {
                            value    : value,
                            oldValue : oldValue,
                            node     : node,
                            variable : variable,
                            frame    : activeFrame,
                            parents  : parents
                        });
                    // });
                });
            });
            
            datagrid.on("before.edit", function(e){
                if (!plugin.enabled)
                    return false;
                
                // Don't allow setting the value of scopes
                if (datagrid.selected.localName == "scope")
                    return false;
                
                // Don't allow setting "this"
                if (datagrid.selected.getAttribute("name") == "this")
                    return false;
            });
            
            datagrid.on("editor.create", function(e){
                var tb = e.editor;
            });
            */
        }
        
        /***** Methods *****/
        
        function loadFrame(frame){
            if (frame == activeFrame)
                return;

            if (!frame) {
                model.setRoot({});
            }
            else {
                if (cached[frame.id])
                    model.setRoot(cached[frame.id]);
                else {
                    model.setRoot(frame.scopes);
                    cached[frame.id] = model.root;
                }
            }
            
            activeFrame = frame;
        }
        
        function findVariableXml(variable){
            return model.queryNode("//variable[@ref=" 
                + util.escapeXpathString(String(variable.ref)) + "]");
        }
        
        function findScopeXml(scope){
            return model.queryNode("//scope[@index=" 
                + util.escapeXpathString(String(scope.index)) + "]");
        }
        
        function updateVariableXml(node, variable, oldVar){
            node.setAttribute("value", oldVar.value = variable.value);
            node.setAttribute("type",  oldVar.type  = variable.type);
            node.setAttribute("ref",   oldVar.ref   = variable.ref);
            if (variable.children && !oldVar.children) {
                datagrid.$setLoadStatus(node, "potential");
                datagrid.$fixItem(node, ui.xmldb.findHtmlNode(node, datagrid));
            }
            apf.xmldb.setAttribute(node, "children", oldVar.children = variable.children);
        }
        
        function updateScope(scope, variables){
            model.setRoot(variables.concat([scope]))
            return 
            // 
            var update = scope.equals(activeFrame);
            var node   = update ? model.data : findScopeXml(scope);
            if (!node) return;
            
            if (update || node.childNodes.length
              && node.childNodes.length == scope.variables.length) {
                var vars = node.selectNodes("variable");
                
                variables.forEach(function(variable, i){
                    var oldVar = (update ? activeFrame : scope).findVariable(null, variable.name);
                    if (vars[i])
                        updateVariableXml(vars[i], variable, oldVar);
                    else
                        debugger; //This shouldn't happen, but it does
                    
                    if (oldVar.properties) {
                        emit("expand", {
                            node     : vars[i],
                            variable : oldVar,
                            expand   : function(){}
                        });
                    }
                });
            }
            else {
                apf.mergeXml(apf.getXml("<p>" + variables.join("") + "</p>"), 
                    node, {clearContents : true});
                apf.xmldb.applyChanges("insert", node);
                //model.appendXml(variables.join(""), node);
            }
        }
        
        function updateVariable(variable, properties, node){
            // Pass node for recursive trees
            if (!node)
                node = findVariableXml(variable);
            if (!node || !node.parentNode)
                return;
            
            // Update xml node
            node.setAttribute("ref", variable.ref);
            node.setAttribute("value", variable.value);
            node.setAttribute("children", variable.children ? "true" : "false");
            apf.xmldb.setAttribute(node, "type", variable.type);
            
            if (node.childNodes.length 
              && node.childNodes.length == variable.properties.length) {
                var vars = node.selectNodes("variable");
                
                properties.forEach(function(prop, i){
                    var oldVar = variable.findVariable(null, prop.name);
                    updateVariableXml(vars[i], prop, oldVar);
                    
                    if (oldVar.properties) {
                        emit("expand", {
                            node     : vars[i],
                            variable : oldVar,
                            expand   : function(){}
                        });
                    }
                })
            }
            else {
                apf.mergeXml(apf.getXml("<p>" + properties.join("") + "</p>"), 
                    node, {clearContents : true});
                apf.xmldb.applyChanges("insert", node);
                //model.appendXml(properties.join(""), node);
            }
        }
        
        function clearCache(){
            cached = {};
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
            plugin.once("draw", draw);
        });
        plugin.on("enable", function(){
            drawn && datagrid.enable();
        });
        plugin.on("disable", function(){
            drawn && datagrid.disable();
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * The local variables and scopes panel for the 
         * {@link debugger Cloud9 debugger}.
         * 
         * This panel displays the local variables and scopes to the user. A
         * user can expand variables and scopes to inspect properties and 
         * variables and edit them.
         * 
         * @singleton
         * @extends DebugPanel
         **/
        plugin.freezePublicAPI({
            /**
             * Sets the frame that the variables and scopes are displayed for.
             * @param {debugger.Frame} frame  The frame to display the variables and scopes from.
             */
            loadFrame : loadFrame,
            
            /**
             * Clears the variable/scope cache
             */
            clearCache : clearCache
        });
        
        register(null, {
            variables: plugin
        });
    }
});