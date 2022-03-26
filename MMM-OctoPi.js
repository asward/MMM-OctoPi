Module.register("MMM-OctoPi", {
    defaults: {
        updateInterval: 60 * 1000,
        retryDelay: 2500,
        printerName: "",
        showStream: true,
        streamUrl: "",
        maxStreamWidth: 0,
        maxStreamHeight: 0,
        showTemps: true,
        showDetailsWhenOffline: true,
        interactive: true, // Set to false to hide the file drop down and only show the stream.
        debugMode: true, // Set to true to log all messages from OctoPrint Socket
        hideInactive: true,
        displayTimeout: 30*60
    },
    state:{
        hidden: true,
        machineState: ""
    },
    displayTimer: null,
    // Define required scripts. 
    getScripts: function() {
      return [            
        this.file('jquery.min.js'),
        this.file('lodash.min.js'),
        this.file('sockjs.min.js'),
        this.file('packed_client.js'),
      ];
    },
    //Override dom generator.
    getDom: function() {
        var self = this;
        var wrapper = document.createElement("div");

        //Guard for hiding
        if(this.state.hidden && this.config.hideInactive){
            wrapper.style.display = 'none';
        } 

        if (this.config.showStream) {
            var stream = document.createElement("img");
            if (this.config.maxStreamWidth != 0) {
                stream.style.maxWidth = this.config.maxStreamWidth + 'px';
            }
            if (this.config.maxStreamHeight != 0) {
                stream.style.maxHeight = this.config.maxStreamHeight + 'px';
            }
            stream.src = (this.config.streamUrl) ? this.config.streamUrl : this.config.url + "/webcam/?action=stream";
            wrapper.appendChild(stream);
        }

        var infoWrapper = document.createElement("div");
        infoWrapper.className = "small";
        if (this.config.printerName === "") {
            infoWrapper.innerHTML = "";
        } else {
            infoWrapper.innerHTML = `<span id="opPrinterName" class="title bright">${this.config.printerName}</span><br />`;
        }
        infoWrapper.innerHTML += `<span>${this.translate("STATE")}: </span><span id="opStateIcon"></span> <span id="opState" class="title bright"> </span>
                <br />
                <div id="opMoreInfo">
                <span>${this.translate("FILE")}: </span><span id="opFile" class="title bright">N/A</span>
                <br />
                <span>${this.translate("ELAPSED")}: </span><span id="opPrintTime" class="title bright">N/A</span>
                <span> | ${this.translate("REMAINING")}: </span><span id="opPrintTimeRemaining" class="title bright">N/A</span>
                <span> | ${this.translate("PERCENT")}: </span><span id="opPercent" class="title bright">N/A</span>
                <br />`;

        if (this.config.showTemps) {
            infoWrapper.innerHTML += `
                <span>${this.translate("TEMPS")} : ${this.translate("NOZZLE")}: </span><span id="opNozzleTemp" class="title bright">N/A</span>
                <span> ${this.translate("TARGET")}: (<span id="opNozzleTempTgt">N/A</span><span>) | ${this.translate("BED")}: </span><span id="opBedTemp" class="title bright">N/A</span>
                <span> ${this.translate("TARGET")}: (<span id="opBedTempTgt">N/A</span><span>)</span>
                </div>
                `;
        }
        wrapper.appendChild(infoWrapper);

        return wrapper;
    },

    start: function() {
        Log.info("Starting module: " + this.name);
        this.loaded = false;
        this.updateTimer = null;

        this.opClient = new OctoPrintClient();
        this.opClient.options.baseurl = this.config.url;
        this.opClient.options.apikey = this.config.api_key;
    },

    initializeSocket: function() {
        var self = this;

        let user = "_api", session = "";
        $.ajax({
            url: this.config.url + "/api/login",
            type: 'post',
            data: { passive: true },
            headers: {
                "X-Api-Key": this.config.api_key
            },
            dataType: 'json',
        }).done((data)=>{
            if (this.config.debugMode) { console.log("Octoprint login response:",data); }
            session = data.session;
            user = data.name;

            // Subscribe to live push updates from the server
            this.opClient.socket.connect();            
        });
        
        this.opClient.socket.onMessage("connected", (message) => {
            this.opClient.socket.sendAuth(user, session);
        });

        if (this.config.debugMode) {
            this.opClient.socket.onMessage("*", (message) => {
                // Reference: http://docs.octoprint.org/en/master/api/push.html#sec-api-push-datamodel-currentandhistory
                console.log("Octoprint", message);
            });
        }

        this.opClient.socket.onMessage("history", (message) => {
            this.updateData(message.data);
        });

        this.opClient.socket.onMessage("current", (message) => {
            this.updateData(message.data);
        });
    },
    hide: function(){
        this.state.hidden = true;
        this.updateDom();
    },
    unhide: function(){
        this.state.hidden = false;
        this.updateDom();
    },
    updateData: function(data) {
        console.log("Updating OctoPrint Data");

        //On status change
        if(data.state.text != this.state.machineState){
            //If leaving 'printing', start timeout timer
            if(this.state.machineState.toLowerCase() === "printing"){ 
                this.displayTimer = setTimeout(()=>this.hide(),this.config.displayTimeout*1000);
            } 
            //If entering printing, remove timer and show immedietly
            if(data.state.text.toLowerCase() === "printing"){ //If we're entering print, clear timer and show
                clearTimeout(this.displayTimer);
                this.unhide();
            }
            this.state.machineState = data.state.text;
        }

        console.log($("#opState")[0]);
        console.log(data.state);
        if(data.state.text.startsWith("Offline (Error: SerialException"))
        {
            $("#opState")[0].textContent =this.translate("OFFLINE");
        }
        else if(data.state.text.startsWith("Offline (Error: Too many consecutive"))
        {
            $("#opState")[0].textContent =this.translate("OFFLINE");
        }
        else
        {
            $("#opState")[0].textContent = data.state.text;
        }

        var icon = $("#opStateIcon")[0];
        if (data.state.flags.printing) {
            icon.innerHTML = `<i class="fa fa-print" aria-hidden="true" style="color:green;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").show(); }
        } else if (data.state.flags.closedOrError) {
            icon.innerHTML = `<i class="fa fa-exclamation-triangle" aria-hidden="true" style="color:red;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").hide(); }
        } else if (data.state.flags.paused) {
            icon.innerHTML = `<i class="fa fa-pause" aria-hidden="true" style="color:yellow;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").show(); }
        } else if (data.state.flags.error) {
            icon.innerHTML = `<i class="fa fa-exclamation-triangle" aria-hidden="true" style="color:red;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").hide(); }
        } else if (data.state.flags.ready) {
            icon.innerHTML = `<i class="fa fa-check-circle" aria-hidden="true" style="color:green;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").show(); }
        } else if (data.state.flags.operational) {
            icon.innerHTML = `<i class="fa fa-check-circle" aria-hidden="true" style="color:green;"></i>`;
            if (!this.config.showDetailsWhenOffline) { $("#opMoreInfo").show(); }
        }

        $("#opFile")[0].textContent = (data.job.file.name) ? data.job.file.name : "N/A";
        $("#opPrintTime")[0].textContent = (data.progress.printTime) ? data.progress.printTime.toHHMMSS() : "N/A";
        $("#opPrintTimeRemaining")[0].textContent = (data.progress.printTimeLeft) ? data.progress.printTimeLeft.toHHMMSS() : "N/A";
        $("#opPercent")[0].textContent = (data.progress.completion) ? Math.round(data.progress.completion) + "%" : "N/A";

        if (this.config.showTemps) {
            if (data.temps.length) {
                var temps = data.temps[data.temps.length - 1];
                if (typeof temps.bed === "undefined") { // Sometimes the last data point is time only, so back up 1.
                    temps = data.temps[data.temps.length - 2];
                }

                $("#opNozzleTemp")[0].innerHTML = (temps.tool0.actual) ? temps.tool0.actual.round10(1) + "&deg;C" : "N/A";
                $("#opNozzleTempTgt")[0].innerHTML = (temps.tool0.target) ? Math.round(temps.tool0.target) + "&deg;C" : "N/A";
                $("#opBedTemp")[0].innerHTML = (temps.bed.actual) ? temps.bed.actual.round10(1) + "&deg;C" : "N/A";
                $("#opBedTempTgt")[0].innerHTML = (temps.bed.target) ? Math.round(temps.bed.target) + "&deg;C" : "N/A";
            }
        }
    },

    notificationReceived: function(notification, payload, sender) {
        if (notification === 'DOM_OBJECTS_CREATED') {
            this.initializeSocket();
        }
    }
});

Number.prototype.toHHMMSS = function() {
    var seconds = Math.floor(this),
        hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    var minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;

    var time = "";

    if (hours !== 0) {
        time = hours + ":";
    }
    if (minutes !== 0 || time !== "") {
        minutes = (minutes < 10 && time !== "") ? "0" + minutes : String(minutes);
        time += minutes + ":";
    }
    if (time === "") {
        time = seconds + "s";
    } else {
        time += (seconds < 10) ? "0" + seconds : String(seconds);
    }
    return time;
};

Number.prototype.round10 = function(precision) {
    var factor = Math.pow(10, precision);
    var tempNumber = this * factor;
    var roundedTempNumber = Math.round(tempNumber);
    return roundedTempNumber / factor;
};
