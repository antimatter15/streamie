/*
 * List of built in plugins for initialization
 */


//i'm not going to bother to rewrite this to be more streamie-ish.
var obj = {
  'Instapaper': {
    icon: 'http://antimatter15.github.com/readability-iframe/instapaper.png',
    callback: function(url){
      var j = document.createElement('script');
      if(!localStorage.Instapaper_user){
        localStorage.Instapaper_user = prompt('What is your Instapaper Username or Email address?');
        localStorage.Instapaper_pass = prompt('What is your Instapaper Password? You might not have one, if so, leave it blank.','');
      }
      var user = encodeURIComponent(localStorage.Instapaper_user), pass = localStorage.Instapaper_pass;
      window.instapaper_callback = function(res){
        var errorCodes = {
          400: "Bad request or exceeded the rate limit. Probably missing a required parameter, such as url.",
          403: "Invalid username or password.",
          500: "The service encountered an error. Please try again later."
        }
        if(res.status != 201){
          alert(errorCodes[res.status]||'This shouldnt be possible.');
          localStorage.Instapaper_user = localStorage.Instapaper_user = '';
        }
      }
      j.src = 'https://www.instapaper.com/api/add?jsonp=instapaper_callback&username='+user+'&pass='+pass+'&url='+encodeURIComponent(url);
      document.body.appendChild(j);
    }
  }
};

window.onmessage = function(e){
  if(e.data.substr(0,8) == 'READREAD'){
    var data = e.data.substr(8);
    obj[data].callback(e.origin);
  }
}


require.def("stream/initplugins",
  ["stream/tweet", "stream/settings", "stream/twitterRestAPI", "stream/helpers", "text!../templates/tweet.ejs.html"],
  function(tweetModule, settings, rest, helpers, templateText) {
    
    settings.registerNamespace("general", "General");
    settings.registerKey("general", "showTwitterBackground", "Show my background from Twitter",  false);
    
    settings.registerNamespace("notifications", "Notifications");
    settings.registerKey("notifications", "favicon", "Highlight Favicon (Website icon)",  true);
    settings.registerKey("notifications", "throttle", "Throttle (Only notify once per minute)", false);
    
    return {
      
      preview: {
        func: function preview() {
          $(window).resize(function(){
            var preview = $("#preview");
            var width = $(window).width() - 450;
            preview.width(width);
          });
          var preview = $("#preview");
          var width = $(window).width() - 450;
          preview.width(width);
          $("#stream").delegate("p.text a", "click", function (e) {
            e.preventDefault();
            var preview = $("#preview");
            var width = $(window).width() - 450;
            preview.width(width);
            preview.show();
            $("#preview iframe").height($(window).height() - 100);
            var href = this.href;
            
           $.getJSON('http://almaer.com/endpoint/resolver.php?callback=?', 
            {url: href}, function (url) {

              var tools = [];
              for(var i in obj){
                tools.push(i+'=='+obj[i].icon);
              }

              var readToolsPart = encodeURIComponent(tools.join(';'));

              preview.find("iframe").attr("src", url + '#readStyle=style-ebook&readSize=size-medium&readMargin=margin-medium&readTools='+readToolsPart);              
            })
          })
        }
      },
      
      // when location.hash changes we set the hash to be the class of our HTML body
      hashState: {
        func: function hashState (stream) {
          function change() {
            var val = location.hash.replace(/^\#/, "");
            $("body").attr("class", val);
            // { custom-event: stat:XXX }
            $(document).trigger("state:"+val);
          }
          $(window).bind("hashchange", change); // who cares about old browsers?
          change();
        }
      },
      
      // change the background to the twitter background
      background: {
        func: function background (stream) {
          settings.subscribe("general", "showTwitterBackground", function (bool) {
            if(bool) {
              stream.userInfo(function (user) {
                if(user.profile_background_image_url) {
                  $("body").css("backgroundImage", "url("+user.profile_background_image_url+")")
                }
              })
            } else {
               $("body").css("backgroundImage", null)
            }
          });
        }
      },
      
      // make the clicked nav item "active"
      navigation: {
        func: function navigation (stream) {
          var mainstatus = $("#mainstatus");
          
          // close mainstatus when user hits escape
          $(document).bind("key:escape", function () {
            if(mainstatus.hasClass("show")) {
              mainstatus.removeClass("show");
            }
          });
          
          $("#header").delegate("#mainnav a", "click", function (e) {
            var a = $(this);
            a.blur();
            var li = a.closest("li");
            
            if(li.hasClass("add")) { // special case for new tweet
              e.preventDefault();
              if(mainstatus.hasClass("show")) {
                mainstatus.removeClass("show");
              } else {
                mainstatus.addClass("show");
                mainstatus.find("[name=status]").focus();
              }
            }
            if(li.hasClass("activatable")) { // special case for new tweet
              a.closest("#mainnav").find("li").removeClass("active");
              li.addClass("active")
            }
          });
          
          mainstatus.bind("status:send", function () {
            mainstatus.removeClass("show");
          });
          
         //  $("#header").delegate("#mainnav li.add", "mouseenter mouseleave", function () {
//             mainstatus.toggleClass("tease");
//           })
        }
      },
      
      // signals new tweets
      signalNewTweets: {
        func: function signalNewTweets () {
          var win = $('#container');
          var dirty = win.scrollTop() > 0;
          var newCount = 0;
          
          function redraw() {
            var signal = newCount > 0 ? "("+newCount+") " : "";
            document.title = document.title.replace(/^(?:\(\d+\) )*/, signal);
          }
          
          win.bind("scroll", function () {
            dirty = win.scrollTop() > 0;
            if(!dirty) { // we scrolled to the top. Back to 0 unread
              newCount = 0;
              setTimeout(function () { // not do this winthin the scroll event. Makes Chrome much happier performance wise.
                $(document).trigger("notify:tweet:unread", [newCount])
              }, 0);
            }
          });
          $(document).bind("notify:tweet:unread", function () {
            redraw();
          });
          $(document).bind("tweet:new", function () {
            newCount++;
            if(dirty) {
              $(document).trigger("tweet:unread", [newCount])
            }
          })
        }
      },      
      
      // tranform "tweet:unread" events into "notify:tweet:unread" events
      // depending on setting, only fire the latter once a minute
      throttableNotifactions: {
        func: function throttableNotifactions () {
          var notifyCount = null;
          setInterval(function () {
            // if throttled, only redraw every N seconds;
            if(settings.get("notifications", "throttle")) {
              if(notifyCount != null) {
                $(document).trigger("notify:tweet:unread", [notifyCount]);
                notifyCount = null;
              }
            }
          }, 60 * 1000) // turn this into a setting
          $(document).bind("tweet:unread", function (e, count) {
            // disable via setting
            if(settings.get("notifications", "throttle")) {
              notifyCount = count;
            } else {
              $(document).trigger("notify:tweet:unread", [count])
            }
          });
        }
      },
      
      // listen to keyboard events and translate them to semantic custom events
      keyboardShortCuts: {
        func: function keyboardShortCuts () {
          
          function trigger(e, name) {
            $(e.target).trigger("key:"+name);
          }
          
          $(document).keyup(function (e) {
            if(e.keyCode == 27) { // escape
              trigger(e, "escape")
            }
          })
        }
      },
      
      personalizeForCurrentUser: {
        func: function personalizeForCurrentUser (stream) {
          $("#currentuser-screen_name").text("@"+stream.user.screen_name)
        }
      },
      
      // sends an event after user
      notifyAfterPause: {
        func: function notifyAfterPause () {
          
          function now() {
            return (new Date).getTime();
          }
          var last = now();
          setInterval(function () { // setInterval will not fire when the computer is asleep
            var time = now();
            var duration = time - last;
            if(duration > 4000) {
              console.log("Awake after "+duration);
              $(document).trigger("awake", [duration]);
            }
            last = time;
          }, 2000)
        }
      },
      
      // display state in the favicon
      favicon: {
        
        canvases: {}, // cache for canvas objects
        colorCanvas: function (color) {
          // remove the current favicon. Just changung the href doesnt work.
          var favicon = $("link[rel~=icon]")
          favicon.remove()
          var canvas = this.canvases[color];
          if(!canvas) {
            // make a quick canvas.
            canvas = document.createElement("canvas");
            canvas.width = 16;
            canvas.height = 16;
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = color;  
            ctx.fillRect(0, 0, 16, 16);
            this.canvases[color] = canvas
          }
          
          // convert canvas to DataURL
          var url = canvas.toDataURL();

          // put in a new favicon
          $("head").append($('<link rel="shortcut icon" type="image/x-icon" href="'+url+'" />'));
        },
        
        func: function favicon (stream, plugin) {
          $(document).bind("notify:tweet:unread", function (e, count) {
            var color = "#000000";
            if(count > 0) {
              color = "#278BF5";
            }
            plugin.colorCanvas(color);
          })
        }
      },
      
      // Use the REST API to load the users's friends timeline, mentions and friends's retweets into the stream
      // this also happens when we detect that the user was offline for a while
      prefillTimeline: {
        func: function prefillTimeline (stream) { 
          
          function prefill () {
            var all = [];
            var returns = 0;
            var calls   = 3;
            var handle = function (tweets, status) {
              returns++;
              if(status == "success") {
                all = all.concat(tweets)
              };
              if(returns == 4) { // all four APIs returned, we can start drawing
                var seen = {};
                all = all.filter(function (tweet) { // filter out dupes
                  var ret = !seen[tweet.id];
                  seen[tweet.id] = true;
                  return ret;
                });
                all = _(all).sortBy(function (tweet) { // sort tweets from all 3 API calls
                  return (new Date(tweet.created_at)).getTime();
                });
                all.forEach(function (tweet) { // process tweets into the stream
                  var t = tweetModule.make(tweet);
                  t.prefill = true;
                  stream.process(t); // if the tweet is already there, is will be filtered away
                })
              }
            }

            
            var since = stream.newestTweet();
            function handleSince(tweets) {
              if(tweets) {
                var oldest = tweets[tweets.length-1];
                if(oldest) {
                  if(parseInt(oldest.id, 10) > since) {
                    oldest._missingTweets = true; // mark the oldest tweet if it is newer than the one we knew before
                  }
                }
                if(oldest) {
                  // fetch other types of statuses since the last regular status
                  rest.get("/1/statuses/retweeted_to_me.json?since_id="+oldest.id, handle);
                  rest.get("/1/statuses/mentions.json?since_id="+oldest.id, handle);
                } else {
                  rest.get("/1/statuses/retweeted_to_me.json?count=20", handle);
                  rest.get("/1/statuses/mentions.json?count=50", handle);
                }
              }
              handle.apply(this, arguments);
            }
            
            // Make API calls
            rest.get("/1/statuses/friends_timeline.json?count=100", handleSince);
            rest.get("/1/favorites.json", handle);
          }
          
          $(document).bind("awake", function (e, duration) { // when we awake, we might have lost some tweets
            setTimeout(prefill, 4000); // wait for network to come online
          });
          
          prefill(); // do once at start
        }
      }
    }
  }
);
