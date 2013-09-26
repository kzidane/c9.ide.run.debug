define(function(require, exports, module) {
    main.consumes = [
        "Panel", "settings", "ui", "layout", "immediate", "run", "panels", 
        "tabManager", "commands" //, "quickwatch"
    ];
    main.provides = ["debugger"];
    return main;

    function main(options, imports, register) {
        var Panel     = imports.Panel;
        var settings  = imports.settings;
        var ui        = imports.ui;
        var tabs      = imports.tabManager;
        var panels    = imports.panels;
        var commands  = imports.commands;
        var immediate = imports.immediate;
        var run       = imports.run;
        
        var markup = require("text!./buttons.xml");
        var css    = require("text!./buttons.css");
        
        /***** Initialization *****/
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index        : 100,
            caption      : "Debugger",
            className    : "debugger",
            elementName  : "winDebugger",
            minWidth     : 165,
            width        : 300,
            where        : "right"
        });
        var emit   = plugin.getEmitter();
        
        var dbg, debuggers = {}, pauseOnBreaks = 0, state = "disconnected";
        var running, activeFrame, sources; 
        
        var enableBreakpoints;
        var container, btnResume, btnStepOver, btnStepInto, btnStepOut, 
            lstScripts, btnSuspend, btnBreakpoints, btnPause, btnBpRemove,
            btnScripts, btnOutput, btnImmediate; // ui elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            settings.on("read", function(){
                settings.setDefaults("user/debug", [
                    ["pause", "0"],
                    ["autoshow", "true"]
                ]);
            });
            
            // Register this panel on the left-side panels
            plugin.setCommand({
                name : "toggledebugger",
                hint : "show the debugger panel",
                // bindKey      : { mac: "Command-U", win: "Ctrl-U" }
            });
            
            // Commands
            
            commands.addCommand({
                name    : "resume",
                group   : "Run & Debug",
                hint    : "resume the current paused process",
                bindKey : {mac: "F8", win: "F8"},
                exec    : function(){
                    dbg && dbg.resume();
                }
            }, plugin);
            commands.addCommand({
                name    : "suspend",
                group   : "Run & Debug",
                hint    : "suspend the current running process",
                // bindKey : {mac: "F8", win: "F8"},
                exec    : function(){
                    dbg && dbg.suspend();
                }
            }, plugin);
            commands.addCommand({
                name    : "stepinto",
                group   : "Run & Debug",
                hint    : "step into the function that is next on the execution stack",
                bindKey : {mac: "F11", win: "F11"},
                exec    : function(){
                    dbg && dbg.stepInto()
                }
            }, plugin);
            commands.addCommand({
                name    : "stepover",
                group   : "Run & Debug",
                hint    : "step over the current expression on the execution stack",
                bindKey : {mac: "F10", win: "F10"},
                exec    : function(){
                    dbg && dbg.stepOver();
                }
            }, plugin);
            commands.addCommand({
                name    : "stepout",
                group   : "Run & Debug",
                hint    : "step out of the current function scope",
                bindKey : {mac: "Shift-F11", win: "Shift-F11"},
                exec    : function(){
                    dbg && dbg.stepOut();
                }
            }, plugin);
            
            // function toggleBreakpoints(force){
            //     enableBreakpoints = force !== undefined
            //         ? force
            //         : !enableBreakpoints;
                
            //     if (btnBreakpoints) {
            //         btnBreakpoints.setAttribute("icon", enableBreakpoints 
            //             ? "toggle_breakpoints2.png" 
            //             : "toggle_breakpoints1.png");
            //         btnBreakpoints.setAttribute("tooltip", 
            //             enableBreakpoints
            //                 ? "Deactivate Breakpoints"
            //                 : "Activate Breakpoints"
            //         );
            //     }
                
            //     emit("breakpointsEnable", {
            //         value : enableBreakpoints
            //     });
            // }
        
            // Update button state
            plugin.on("stateChange", function(e){
                state = e.state;
                
                if (!btnResume)
                    return;
    
                btnResume.$ext.style.display = state == "stopped" 
                    ? "inline-block" : "none";
                btnSuspend.$ext.style.display = state == "disconnected" 
                    || state != "stopped" ? "inline-block" : "none";
                    
                btnSuspend.setAttribute("disabled",     state == "disconnected");
                btnStepOver.setAttribute("disabled",    state == "disconnected" || state != "stopped");
                btnStepInto.setAttribute("disabled",    state == "disconnected" || state != "stopped");
                btnStepOut.setAttribute("disabled",     state == "disconnected" || state != "stopped");
                btnScripts.setAttribute("disabled",     state == "disconnected" || state != "stopped");
                // lstScripts.setAttribute("disabled",     state == "disconnected" || state != "stopped");
            });
        }
        
        var drawn;
        function draw(opts){
            if (drawn) return;
            drawn = true;
            
            // Import Skin
            ui.insertSkin({
                name         : "debugger",
                data         : require("text!./skin.xml"),
                "media-path" : options.staticPrefix + "/images/",
                "icon-path"  : options.staticPrefix + "/icons/"
            }, plugin);
            
            // Create UI elements
            var bar = opts.aml.appendChild(new ui.bar({
                "id"    : "winDebugger",
                "skin"  : "panel-bar",
                "class" : "debugcontainer"
            }));
            plugin.addElement(bar);
            
            var scroller = bar.$ext.appendChild(document.createElement("div"));
            scroller.className = "scroller";
            
            // Load CSS
            ui.insertCss(css, plugin);
            
            // Create UI elements
            var parent = options.aml;
            ui.insertMarkup(parent, markup, plugin);
            
            container = plugin.getElement("hbox");
            
            btnResume      = plugin.getElement("btnResume");
            btnStepOver    = plugin.getElement("btnStepOver");
            btnStepInto    = plugin.getElement("btnStepInto");
            btnStepOut     = plugin.getElement("btnStepOut");
            lstScripts     = plugin.getElement("lstScripts");
            btnSuspend     = plugin.getElement("btnSuspend");
            btnBreakpoints = plugin.getElement("btnBreakpoints");
            btnBpRemove    = plugin.getElement("btnBpRemove");
            btnPause       = plugin.getElement("btnPause");
            btnScripts     = plugin.getElement("btnScripts");
            btnOutput      = plugin.getElement("btnOutput");
            btnImmediate   = plugin.getElement("btnImmediate");
            
            // @todo move this to F8 and toggle between resume
            // btnSuspend.on("click", function(){
            //     suspend();
            // });
            
            // btnBreakpoints.on("click", function(){
            //     toggleBreakpoints();
            // });
            
            // buttons.on("breakpointsRemove", function(e){
            //     breakpoints.breakpoints.forEach(function(bp){
            //         breakpoints.clearBreakpoint(bp);
            //     });
            // }, plugin);
            // buttons.on("breakpointsEnable", function(e){
            //     e.value
            //         ? breakpoints.activateAll()
            //         : breakpoints.deactivateAll();
            // }, plugin);
            // breakpoints.on("active", function(e){
            //     buttons.enableBreakpoints = e.value;
            // }, plugin);
            
            // @todo move this to the breakpoints plugin
            btnBpRemove.on("click", function(){
                emit("breakpointsRemove");
            });
            
            // settings.on("read", function(){
            //     buttons.enableBreakpoints = breakpoints.enableBreakpoints;
            //     buttons.pauseOnBreaks = pauseOnBreaks =
            //         settings.getNumber("user/debug/@pause");
            // });
            
            btnPause.on("click", function(){
                togglePause();
            });
            
            btnOutput.on("click", function(){
                commands.exec("showoutput");
            });
            
            btnImmediate.on("click", function(){
                commands.exec("showimmediate");
            });
            
            // @todo Move this to the callstack plugin
            // Load the scripts in the sources dropdown
            // buttons.getElement("lstScripts", function(lstScripts){
            //     lstScripts.setModel(callstack.modelSources);
                
            //     lstScripts.on("afterselect", function(e){
            //         callstack.openFile({
            //             scriptId  : e.selected.getAttribute("id"),
            //             path      : e.selected.getAttribute("path"),
            //             generated : true
            //         });
            //     }, plugin)
            // });
            btnScripts.setAttribute("submenu", lstScripts.parentNode);
            
            emit("draw", { html: scroller, aml: bar });
        }
        
        /***** Methods *****/
        
        function initializeDebugger(){
            // State Change
            var stateTimer;
            dbg.on("stateChange", function(e){
                var action = e.state == "running" ? "disable" : "enable";
                
                // Wait for 500ms in case we are step debugging
                clearTimeout(stateTimer);
                if (action == "disable")
                    stateTimer = setTimeout(function(){
                        updatePanels(action, e.state);
                    }, 500);
                else {
                    updatePanels(action, e.state);
                }
            }, plugin);
            
            // Receive the breakpoints on attach
            dbg.on("attach", function(e){
                e.implementation = dbg;
                emit("attach", e);
            }, plugin);
            
            dbg.on("detach", function(e){
                // buttons.state = "detached";
                state = "disconnected";
                emit("stateChange", { state: state });
                
                //@todo
                emit("detach", e);
            }, plugin);
            
            // When hitting a breakpoint or exception or stepping
            function startDebugging(e){
                if (settings.getBool("user/debug/@autoshow"))
                    panels.activate("debugger");
                
                // Reload Frames
                emit("framesLoad", e);
                
                // Process Exception
                if (e.exception) {
                    // @todo add this into the ace view?
                }
                
                emit("break", e);
            }
            dbg.on("break", startDebugging, plugin);
            dbg.on("exception", startDebugging, plugin);
            dbg.on("suspend", function(){
                dbg.getFrames(function(err, frames){
                    if (frames.length) {
                        startDebugging({
                            frames : frames,
                            frame  : frames[0]
                        });
                    }
                });
            }, plugin);
            
            // When a new frame becomes active
            dbg.on("frameActivate", function(e){
                activeFrame = e.frame;
                emit("frameActivate", e);
            }, plugin);
            
            // @todo move to open method
            // Clicking on the call stack
            // callstack.on("beforeOpen", function(e){
            //     return emit("beforeOpen", e);
            // }, plugin)
            
            // @todo move to open method
            // callstack.on("open", function(e){
            //     function done(err, value){
            //         if (err) return; //@todo util.alert?
                    
            //         if (emit("open", { 
            //             path   : e.source.path, 
            //             source : e.source,
            //             value  : value,
            //             done   : e.done,
            //             tab    : e.tab
            //         }) !== false)
            //             e.done(value);
            //     }
                
            //     //!e.generated && 
            //     if ((e.source.path || "").charAt(0) == "/") {
            //         fs.readFile(e.source.path, "utf8", done);
            //     }
            //     else {
            //         dbg.getSource(e.source, done);
            //         e.tab.document.getSession().readOnly = true;
            //     }
            // }, plugin)
            
            dbg.on("sources", function(e){
                sources = e.sources;
                emit("sources", e);
            }, plugin);
            
            dbg.on("sourcesCompile", function(e){
                sources.push(e.source);
                emit("sourcesCompile", e);
            }, plugin);
            
            dbg.on("breakpointUpdate", function(e){
                emit("breakpointUpdate", {
                    breakpoint : e.breakpoint, 
                    action     : "add", 
                    force      : true
                });
            }, plugin);

            // Immediate 
            // immediate.addType("Debugger (current frame)", "debug-frame", plugin);
            // immediate.addType("Debugger (global)", "debug-global", plugin);

            // immediate.on("evaluate", function(e){
            //     if (e.type.substr(0, 5) == "debug") {
            //         var global = e.type.indexOf("global") > -1;
                    
            //         dbg.evaluate(e.expression, null, global, false, 
            //             function(err, value, body, refs){
            //                 if (err) 
            //                     e.output.error(err.message, err.stack);
            //                 else {
            //                     // @todo expand this do display types, etc.
            //                     //       probably best to move that into immediate
            //                     e.output.log(value.value);
            //                 }
                            
            //                 watches.updateAll();
            //                 if (!global)
            //                     callstack.updateAll();
                            
            //                 e.done();
            //             }
            //         )
            //     }
            // }, plugin);
            
            // Quickwatch
            //@todo
        }
        
        function updatePanels(action, runstate){
            state = running != run.STOPPED ? runstate : "disconnected";
            emit("stateChange", { state: state, action: action });
        }
        
        function togglePause(force){
            pauseOnBreaks = force !== undefined
                ? force
                : (pauseOnBreaks > 1 ? 0 : pauseOnBreaks + 1);

            if (btnPause) {
                btnPause.setAttribute("class", "pause" + pauseOnBreaks);
                btnPause.setAttribute("tooltip", 
                    pauseOnBreaks === 0
                        ? "Don't pause on exceptions"
                        : (pauseOnBreaks == 1
                            ? "Pause on all exceptions"
                            : "Pause on uncaught exceptions")
                );
            }
            
            dbg.setBreakBehavior(
                pauseOnBreaks === 1 ? "uncaught" : "all",
                pauseOnBreaks === 0 ? false : true
            );
            
            pauseOnBreaks = pauseOnBreaks;
            settings.set("user/debug/@pause", pauseOnBreaks);
        }
        
        function registerDebugger(type, debug){
            debuggers[type] = debug;
        }
        
        function unregisterDebugger(type, debug){
            if (debuggers[type] == debug)
                delete debuggers[type];
        }
        
        function debug(process, callback){
            var err;
            
            var runner = process.runner;
            if (runner instanceof Array)
                runner = runner[runner.length - 1];
            
            // Only update debugger implementation if switching or not yet set
            if (!dbg || dbg != debuggers[runner["debugger"]]) {
                
                // Currently only supporting one debugger at a time
                if (dbg) {
                    // Detach from runner
                    dbg.detach();
                    
                    // Remove all the set events
                    plugin.cleanUp(true);
                }
                
                // Find the new debugger
                dbg = debuggers[runner["debugger"]];
                if (!dbg) {
                    err = new Error(runner["debugger"]
                        ? "Unable to find a debugger with type " + runner["debugger"]
                        : "No debugger type specified in runner");
                    err.code = "EDEBUGGERNOTFOUND";
                    return callback(err);
                }
                
                // Attach all events necessary
                initializeDebugger();
            }
            
            if (process.running == process.STARTED)
                running = process.STARTED;
            else {
                process.on("started", function(){
                    running = run.STARTED;
                    // buttons.state = state;
                }, plugin);
            }
            process.on("stopped", function(){
                running = run.STOPPED;
                // buttons.state = "disconnected";
            }, plugin);
            
            // Hook for plugins to delay or cancel debugger attaching
            // Whoever cancels is responible for calling the callback
            if (emit("beforeAttach", {
                runner   : runner, 
                callback : callback
            }) === false)
                return;
            
            // Attach the debugger to the running process
            dbg.attach(runner, emit("getBreakpoints"), callback);
        }
        
        function stop(){
            if (!dbg) return;
            
            // Detach from runner
            dbg && dbg.detach();
            
            updatePanels("disable", "disconnected");
            
            if (settings.getBool("user/debug/@autoshow"))
                panels.deactivate("debugger");
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("draw", function(e){
            draw(e);
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Generic Debugger for Cloud9 IDE. This plugin is responsible for 
         * binding the different debug panels to a debugger implementation.
         * 
         * The default debug panels are:
         * 
         * * {@link breakpoints}
         * * {@link buttons}
         * * {@link callstack}
         * * {@link variables}
         * * {@link watches}
         * 
         * #### Remarks
         * 
         * * The debugger also works together with the {@link immediate Immediate Panel}.
         * * If you want to create a debugger for your platform, check out the
         * {@link debugger.implementation} reference specification.
         * * The debugger implementation is choosen based on configuration
         * variables in the runner. See {@link #debug} and {@link run#run} for
         * more information on runners.
         * 
         * The following example shows how to start a debugger and 
         * programmatically work with breakpoints and breaks:
         * 
         *     // Start a process by executing example.js with the 
         *     // default runner for that extension (Node.js)
         *     var process = run.run("auto", {
         *         path  : "/example.js",
         *         debug : true
         *     }, function(err, pid){
         *     
         *         // When a breakpoint is hit, ask if the user wants to break.
         *         debug.on("break", function(){
         *             if (!confirm("Would you like to break here?"))
         *                 debug.resume();
         *         });
         *         
         *         // Set a breakpoint on the first line of example.js
         *         debug.setBreakpoint({
         *             path       : "/example.js",
         *             line       : 0,
         *             column     : 0,
         *             enabled    : true
         *         });
         *         
         *         // Attach a debugger to the running process
         *         debug.debug(process.runner, function(err){
         *             if (err) throw err.message;
         *         });
         *     });
         *
         * @singleton
         */
        plugin.freezePublicAPI({
            /**
             * When the debugger has hit a breakpoint or an exception, it breaks
             * and shows the active frame in the callstack panel. The active
             * frame represents the scope at which the debugger is stopped.
             * @property {debugger.Frame} activeFrame
             */
            get activeFrame(){ return activeFrame; },
            set activeFrame(frame){ 
                activeFrame = frame; 
                emit("frameActivate", { frame: frame });
            },
            /**
             * A list of sources that are available from the debugger. These
             * can be files that are loaded in the runtime as well as code that
             * is injected by a script or by the runtime itself.
             * @property {debugger.Source[]} sources
             * @readonly
             */
            get sources(){ return sources; },
            /**
             * Retrieves if the debugger will break on exceptions
             * @property {Boolean} breakOnExceptions
             * @readonly
             */
            get breakOnExceptions(){ return dbg.breakOnExceptions; },
            /**
             * Retrieves whether the debugger will break on uncaught exceptions
             * @property {Boolean} breakOnUncaughtExceptions
             * @readonly
             */
            get breakOnUncaughtExceptions(){ return dbg.breakOnUncaughtExceptions; },
            /**
             * 
             */
            get pauseOnBreaks(){ return pauseOnBreaks; },
            set pauseOnBreaks(v){ 
                pauseOnBreaks = v; 
                togglePause(v);
            },
            /**
             * 
             */
            get enableBreakpoints(){ return enableBreakpoints; },
            set enableBreakpoints(v){ 
                enableBreakpoints = v;
                toggleBreakpoints(v);
            },
            
            _events : [
                /**
                 * Fires prior to a debugger attaching to a process.
                 * 
                 * This event serves as a hook for plugins to delay or 
                 * cancel a debugger attaching. Whoever cancels is responible 
                 * for calling the callback.
                 * 
                 * @event beforeAttach
                 * @cancellable
                 * @param {Object}   e
                 * @param {Object}   e.runner    The object that is running the process. See {@link #debug}.
                 * @param {Function} e.callback  The callback with which {@link #debug} was called.
                 */
                "beforeAttach",
                /**
                 * Fires when the debugger has attached itself to the process.
                 * @event attach
                 * @param {Object}                  e
                 * @param {debugger.Breakpoint[]}   e.breakpoints     The breakpoints that are currently set.
                 * @param {debugger.implementation} e.implementation  The used debugger implementation
                 */
                "attach",
                /**
                 * Fires when the debugger has detached itself from the process.
                 * @event detach
                 */
                "detach",
                /**
                 * Fires when the callstack frames have loaded for current 
                 * frame that the debugger is breaked at.
                 * @event framesLoad
                 * @param {Object}           e
                 * @param {debugger.Frame[]} e.frames  The frames of the callstack.
                 */
                "framesLoad",
                /**
                 * Fires when the debugger hits a breakpoint or an exception.
                 * @event break
                 * @param {Object}           e
                 * @param {debugger.Frame}   e.frame        The frame where the debugger has breaked at.
                 * @param {debugger.Frame[]} [e.frames]     The callstack frames.
                 * @param {Error}            [e.exception]  The exception that the debugger breaked at.
                 */
                "break",
                /**
                 * Fires prior to opening a file from the debugger.
                 * @event beforeOpen
                 * @cancellable
                 * @param {Object}          e
                 * @param {debugger.Source} e.source     The source file to open.
                 * @param {Object}          e.state      The state object that is passed to the {@link tabManager#open} method.
                 * @param {Boolean}         e.generated  Specifies whether the file is a generated file.
                 */
                "beforeOpen",
                /**
                 * Fires when a file is opened from the debugger.
                 * @event open
                 * @cancellable
                 * @param {Object}          e
                 * @param {debugger.Source} e.source      The source file to open.
                 * @param {String}          e.path        The path of the source file to open
                 * @param {String}          e.value       The value of the source file.
                 * @param {Function}        e.done        Call this function if you are cancelling the event.
                 * @param {Function}        e.done.value  The value of the source file
                 * @param {Tab}             e.tab         The created tab for the source file.
                 */
                "open",
                /**
                 * Fires when a breakpoint is updated from the UI
                 * @event breakpointsUpdate
                 * @param {Object} e
                 * @param {debugger.Breakpoint} breakpoint
                 * @param {String}              action      One of the following 
                 *   possible values: "add", "remove", "condition", "enable", "disable".
                 * @param {Boolean}             force       Specifies whether the update is forced.
                 */
                "breakpointsUpdate"
            ],
            
            /**
             * Attaches the debugger that is specified by the runner to the
             * running process that is started using the same runner.
             * 
             * *N.B.: There can only be one debugger attached at the same time.*
             * 
             * @param {Object}   runnner        The runner as specified in {@link run#run}.
             * @param {Function} callback       Called when the debugger is attached.
             * @param {Error}    callback.err   Error object with information on an error if one occured.
             */
            debug : debug,
            
            /**
             * Detaches the started debugger from it's process.
             */
            stop : stop,
            
            /**
             * Registers a {@link debugger.implementation debugger implementation}
             * with a unique name. This name is used as the "debugger" property
             * of the runner.
             * @param {String}                  name      The unique name of this debugger implementation.
             * @param {debugger.implementation} debugger  The debugger implementation.
             */
            registerDebugger : registerDebugger,
            
            /**
             * Unregisters a{@link debugger.implementation debugger implementation}.
             * @param {String}                  name      The unique name of this debugger implementation.
             * @param {debugger.implementation} debugger  The debugger implementation.
             */
            unregisterDebugger : unregisterDebugger,
            
            /**
             * Continues execution of a process after it has hit a breakpoint.
             */
            resume : function(){ dbg.resume() },
            
            /**
             * Pauses the execution of a process at the next statement.
             */
            suspend : function(){ dbg.suspend() },
            
            /**
             * Step into the next statement.
             */
            stepInto : function(){ dbg.stepInto() },
            
            /**
             * Step out of the current statement.
             */
            stepOut : function(){ dbg.stepOut() },
            
            /**
             * Step over the next statement.
             */
            stepOver : function(){ dbg.stepOver() },
            
            /**
             * Retrieves the contents of a source file from the debugger (not 
             * the file system).
             * @param {debugger.Source} source         The source file.
             * @param {Function}        callback       Called when the contents is retrieved.
             * @param {Function}        callback.err   Error object if an error occured.
             * @param {Function}        callback.data  The contents of the file.
             */
            getSource : function(source, callback){ 
                dbg.getSource(source, callback);
            },
            
            /**
             * Defines how the debugger deals with exceptions.
             * @param {"all"/"uncaught"} type          Specifies which errors to break on.
             * @param {Boolean}          enabled       Specifies whether to enable breaking on exceptions.
             * @param {Function}         callback      Called after the setting is changed.
             * @param {Error}            callback.err  The error if any error occured.
             */
            setBreakBehavior : function(type, enabled, callback){ 
                dbg.setBreakBehavior(type, enabled, callback); 
            },
            
            /**
             * Evaluates an expression in a frame or in global space.
             * @param {String}            expression         The expression.
             * @param {debugger.Frame}    frame              The stack frame which serves as the contenxt of the expression.
             * @param {Boolean}           global             Specifies whether to execute the expression in global space.
             * @param {Boolean}           disableBreak       Specifies whether to disabled breaking when executing this expression.
             * @param {Function}          callback           Called after the expression has executed.
             * @param {Error}             callback.err       The error if any error occured.
             * @param {debugger.Variable} callback.variable  The result of the expression.
             */
            evaluate : function(expression, frame, global, disableBreak, callback){ 
                dbg.evaluate(expression, frame, global, disableBreak, callback); 
            },
            
            /**
             * Adds a breakpoint to a line in a source file.
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to add.
             */
            setBreakpoint : breakpoints.setBreakpoint,
            
            /**
             * Removes a breakpoint from a line in a source file.
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to remove.
             */
            clearBreakpoint : breakpoints.clearBreakpoint,
            
            openFile : openFile
        });
        
        register(null, {
            "debugger": plugin
        });
    }
});